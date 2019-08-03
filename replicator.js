const Big = require('big.js');

const DEFAULT_SIDE = {
  max_value: '100',
  target_value: '100',
  scale: '0.25',
  levels: 2,
  spread: '0.005',
  level_slope: '1.0001',
};

const DEFAULT_BASE = {
  price_adjust: '1',
};

const NO_ORDER = Promise.resolve({ order_token: 0 });

class Replicator {
  constructor(target, sources) {
    this._target = target;
    this._resting_orders = {};

    this._sources = sources.map(source => {
      const iface = source.exchange.iface;

      let s = {
        ...DEFAULT_BASE,
        ...source,
        buy: {
          ...DEFAULT_SIDE,
          ...source.base,
          ...source.buy,
          is_buy: true,
          level_read: iface.readLevels.bind(iface, source.exchange.market, true),
        },
        sell: {
          ...DEFAULT_SIDE,
          ...source.base,
          ...source.sell,
          is_buy: false,
          level_read: iface.readLevels.bind(iface, source.exchange.market, false)
        },
      };

      const buy_spread = Big(1).sub(s.buy.spread);
      s.buy.spread = idx => buy_spread.div(Big(s.buy.level_slope).pow(idx));

      const sell_spread = Big(1).add(s.sell.spread);
      s.sell.spread = idx => sell_spread.mul(Big(s.sell.level_slope).pow(idx));

      return s;
    });
  }

  refresh() {
    this._sources.forEach(source => this._replicate(source));
  }

  _replicate(source) {
    const buy_orders = this._buildOrders(source, source.buy);
    const sell_orders = this._buildOrders(source, source.sell);

    /* order buys and sell placement to prevent self-trading */
    let i = 0;
    for (i = 0; i < Math.min(buy_orders.length, sell_orders.length); ++i) {
      this._replaceOrder(sell_orders[i]);
      this._replaceOrder(buy_orders[i]);
    }

    for (i = 0; i < sell_orders.length; ++i) {
      this._replaceOrder(sell_orders[i]);
    }

    for (i = 0; i < buy_orders.length; ++i) {
      this._replaceOrder(buy_orders[i]);
    }
  }

  _replaceOrder(order) {
    const resting_lookup = this._getResting(order.market, order.is_buy);
    const existing = resting_lookup[order.pos] || NO_ORDER;

    resting_lookup[order.pos] = existing.then(report => {
      if (report.order_token !== 0) {
        const age = Date.now() - (report.timestamp || 0);
        const quant_diff = Big(order.quantity).sub(report.quantity).abs();
        const is_small_diff = quant_diff.lt(Big(report.quantity).mul('0.1'));

        /* old order is similar, ignore */
        if (is_small_diff && age < 10000 && Big(report.price).eq(order.price)) {
          return report;
        }

        console.log('replace', order.market, order.is_buy, order.pos, report.price, 'with', order.price);
      }
      else {
        console.log('new order', order.market, order.is_buy, order.pos, 'at', order.price);
      }

      order.replace_order_token = report.order_token;
      return this._target.newOrder(order)
        .then(report => {
          report.timestamp = Date.now();
          return report;
        })
    })
    .catch(e => {
      console.error(e);
      return existing;
    });
  }

  _getResting(market, is_buy) {
    let m = this._resting_orders[market];
    if (!m) {
      m = this._resting_orders[market] = {};
    }
    let s = m[is_buy];
    if (!s) {
      s = m[is_buy] = {};
    }
    return s;
  }

  _buildOrders(source, source_side) {
    let value = Big(source_side.target_value);
    if (value.gt(source_side.max_value)) {
      value = Big(source_side.max_value);
    }

    let levels = this._collectLevels(
      source_side.level_read,
      value,
      source_side.scale,
      source.price_adjust
    );

    levels = this._distributeLevels(levels, source_side.levels);

    return levels.map((level, pos) => ({
      market: source.market,
      pos,
      price: Big(level.price.mul(source_side.spread(pos)).toPrecision(5)) + '',
      quantity: level.quantity.toFixed(0),
      is_buy: source_side.is_buy,
    }));
  }

  _collectLevels(read, remaining, book_scale, price_adjust) {
    const orders = [];

    read(level => {
      const price = Big(level[0]).mul(price_adjust);
      Big.DP = 8;

      const size = Big(level[1]).mul(book_scale).div(price_adjust);
      const value = price.mul(size);

      Big.DP = 8;
      orders.push({
        price,
        quantity: remaining.gt(value) ? size : remaining.div(price),
      });

      remaining = remaining.sub(value);
      return remaining.lte(0);
    });

    return orders;
  }

  _distributeLevels(levels, count) {
    if (levels.length === 0 || levels.length === count) {
      return levels;
    }

    if (levels.length < count) {
      const last_order_idx = levels.length - 1;
      const last_order = levels[last_order_idx];

      const split = count - last_order_idx;
      Big.DP = 8;

      last_order.quantity = last_order.quantity.div(split);

      for (let i = levels.length; i < count; ++i) {
        levels.push({
          ...last_order,
        });
      }

      return levels;
    }

    const extra = levels.count - count;
    const last_order = levels[count - 1];

    for (let i = count; i < levels.length; ++i) {
      last_order.price = levels[i].price;
      last_order.quantity = last_order.quantity.add(levels[i].quantity);
    }

    return levels.slice(0, count);
  }
}

module.exports = Replicator;
