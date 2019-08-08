const Big = require('big.js');

const DEFAULT_SIDE = {
  quantity_limits: {},
  scale: '0.25',
  levels: 2,
  spread: '0.005',
  level_slope: '1.0001',
};

const DEFAULT_BASE = {
  price_adjust: '1',
  rebalance: false,
};

const ZERO = Big(0);

const NO_ORDER = Promise.resolve({order_token: 0});

function getLimit(limits) {
  let limit = null;
  Object.keys(limits).forEach(key => {
    let v = limits[key];
    if (!v) {
      return;
    }

    v = Big(v);
    if (!limit || limit.gt(v)) {
      limit = v;
    }
  });

  return limit;
}

class Replicator {
  constructor(target, sources) {
    this._target = target;
    this._resting_orders = {};
    this._position = {};

    this._sources = sources.map(source => {
      const iface = source.exchange.iface;

      let s = {
        ...DEFAULT_BASE,
        ...source,
        buy: {
          ...DEFAULT_SIDE,
          ...source.base,
          ...source.buy,
          value_limits: {
            ...DEFAULT_SIDE.value_limits,
            ...(source.base && source.base.value_limits),
            ...(source.buy && source.buy.value_limits),
          },
          quantity_limits: {
            ...DEFAULT_SIDE.quantity_limits,
            ...(source.base && source.base.quantity_limits),
            ...(source.buy && source.buy.quantity_limits),
          },
          is_buy: true,
          level_read: iface.readLevels.bind(iface, source.exchange.market, true),
        },
        sell: {
          ...DEFAULT_SIDE,
          ...source.base,
          ...source.sell,
          value_limits: {
            ...DEFAULT_SIDE.value_limits,
            ...(source.base && source.base.value_limits),
            ...(source.sell && source.sell.value_limits),
          },
          quantity_limits: {
            ...DEFAULT_SIDE.quantity_limits,
            ...(source.base && source.base.quantity_limits),
            ...(source.sell && source.sell.quantity_limits),
          },
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

    this._handleRestingOrder = this._handleRestingOrder.bind(this);
    this._target.handleMatch(this._onMatch.bind(this));
  }

  refreshResting() {
    return this._target.getResting().then(orders => orders.forEach(this._handleRestingOrder));
  }

  _handleRestingOrder(order) {
    const resting_orders = this._getResting(order.market, order.is_buy);
    const source = this._sources.find(s => s.market === order.market);
    if (!source) {
      this._target.cancelOrder(order);
      return;
    }

    const source_side = order.is_buy
      ? source.buy
      : source.sell;

    let open_idx = -1;
    for (let i = 0; i < source_side.levels; ++i) {
      const resting = resting_orders[i];

      if (!resting) {
        open_idx = i;
      } else if (resting.order
        && +resting.order.order_token === +order.order_token) {
        return;
      }
    }

    if (open_idx !== -1) {
      resting_orders[open_idx] = Promise.resolve(order);
      return;
    }

    this._target.cancelOrder(order);
  }

  _onMatch(report) {
    const source = this._sources.find(s => s.market === report.market);
    if (!source.rebalance) {
      return;
    }

    let position = this._position[source.market];
    if (!position) {
      position = {
        source,
        current: {
          quote: ZERO,
          base: ZERO,
        },
        target: {
          quote: ZERO,
          base: ZERO,
        },
      };
      this._position[source.market] = position;
    }

    if (report.is_buy) {
      const value = Big(report.quantity).mul(report.price);
      position.target.quote = position.target.quote.sub(value);
      position.target.base = position.target.base.add(report.quantity);
    } else {
      const value = Big(report.quantity).mul(report.price);
      position.target.quote = position.target.quote.add(value);
      position.target.base = position.target.base.sub(report.quantity);
    }

    this._balancePosition(position);
  }

  _balancePosition(position) {
    const quote_delta = position.target.quote.sub(position.current.quote);
    const base_delta = position.target.base.sub(position.current.base);

    const {iface, fees, price_decimals} = position.source.exchange;

    position.current.quote = position.current.quote.add(quote_delta);
    position.current.base = position.current.base.add(base_delta);

    let p;

    if (quote_delta.gt(0) && base_delta.lt(0)) {
      p = iface.newOrder({
        market: position.source.exchange.market,
        is_buy: true,
        size: ZERO.sub(base_delta).toFixed(8),
        price: ZERO.sub(quote_delta.div(base_delta)).div(Big(1).add(position.source.exchange.fees)).toFixed(price_decimals),
      });
    } else if (quote_delta.lt(0) && base_delta.gt(0)) {
      p = iface.newOrder({
        market: position.source.exchange.market,
        is_buy: false,
        size: base_delta.toFixed(8),
        price: ZERO.sub(quote_delta.div(base_delta)).mul(Big(1).add(position.source.exchange.fees)).toFixed(price_decimals),
      });
    }

    p.catch(err => {
      position.current.quote = position.current.quote.sub(quote_delta);
      position.current.base = position.current.base.sub(base_delta);
    });
  }

  refreshSourceBalances() {
    const to_load = [];
    const exchanges = {};

    /* load balances from each source exchnage */
    this._sources.forEach(source => {
      const {iface} = source.exchange;
      if (exchanges[iface.name]) {
        return;
      }

      const p = iface.getBalances();
      exchanges[iface.name] = p.then(res => {
        exchanges[iface.name] = res;
      });
      to_load.push(p);
    });

    return Promise.all(to_load)
      .then(() => {
        /* set limits based on available balance on source exchnage */
        this._sources.forEach(source => {
          if (!source.rebalance) {
            return;
          }

          const balances = exchanges[source.exchange.iface.name];
          source.buy.value_limits.source_balance = balances[source.exchange.quote].available;
          source.sell.quantity_limits.source_balance = balances[source.exchange.base].available;
        });
      });
  }

  getSource(market) {
    return this._sources.find(s => s.market === market);
  }

  refreshOrders() {
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

  _replaceOrder(details) {
    const resting_lookup = this._getResting(details.market, details.is_buy);
    const existing = resting_lookup[details.pos] || NO_ORDER;

    const p = existing.then(report => {
      if (report.order_token !== 0) {
        const age = Date.now() - (report.timestamp || 0);
        const quant_diff = Big(details.quantity).sub(report.quantity).abs();
        const is_small_diff = !quant_diff.gt(Big(report.quantity).mul('0.2'));

        /* old order is similar, ignore */
        if (is_small_diff && age < 10000 && Big(report.price).eq(details.price)) {
          p.order = existing.order;
          return report;
        }

        console.log('replace', details.market, details.is_buy, details.pos, report.price, 'with', details.price);
      } else {
        console.log('new order', details.market, details.is_buy, details.pos, 'at', details.price);
      }

      details.replace_order_token = report.order_token;
      const order = this._target.newOrder(details);
      order.result.order = order;

      return order.result;
    }).catch(e => {
      console.error(e);
      return existing;
    });

    resting_lookup[details.pos] = p;
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
    const remaining = {
      quantity: getLimit(source_side.quantity_limits),
      value: getLimit(source_side.value_limits),
    };

    let levels = this._collectLevels(
      source_side.level_read,
      remaining,
      source_side.scale,
      source.price_adjust
    );

    levels = this._distributeLevels(levels, source_side.levels);

    return levels.map((level, pos) => ({
      market: source.market,
      pos,
      price: Big(level.price.mul(source_side.spread(pos)).toPrecision(5)) + '',
      quantity: level.quantity.toFixed(8),
      is_buy: source_side.is_buy,
    }));
  }

  _collectLevels(read, remaining, book_scale, price_adjust) {
    const levels = [];

    read(level => {
      const price = Big(level[0]).mul(price_adjust);
      Big.DP = 8;

      const quantity = Big(level[1]).mul(book_scale).div(price_adjust);
      const value = price.mul(quantity);

      let level_quantity;
      let done = false;

      /* not blocked by remaining.value */
      if (!remaining.value || remaining.value.gt(value)) {

        /* blocked by remaining.quantity */
        if (remaining.quantity && remaining.quantity.lt(quantity)) {
          level_quantity = remaining.quantity;
          done = true;
        }

        /* not blocked by remaining.quantity */
        else {
          level_quantity = quantity;
        }
      }
      /* blocked by remaining.value */
      else {
        Big.DP = 8;
        level_quantity = remaining.value.div(price);
        done = true;

        /* blocked further by remaining.quantity */
        if (remaining.quantity && remaining.quantity.lt(level_quantity)) {
          level_quantity = remaining.quantity;
        }
      }

      levels.push({
        price,
        quantity: level_quantity,
      });

      if (remaining.value) {
        remaining.value = remaining.value.sub(price.mul(level_quantity));
      }

      if (remaining.quantity) {
        remaining.quantity = remaining.quantity.sub(level_quantity);
      }

      return done;
    });

    return levels;
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
