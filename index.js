const settings = require('./settings');
const merkleX = require('merklex');
const CoinbasePro = require('coinbase-pro');
const Big = require('big.js');

const markets = [
  {
    merklex: 'WETH-DAI',
    coinbase: 'ETH-USD',
    value: '200.0',
    profit: '0.005',
    level_slope: '1.002',
    levels: 3,
    book_scale: '0.25',
    limit: {
      market: 'WETH-DAI',
      min_quote: '-1000',
      min_base: '-10',
      long_max_price: '350',
      short_min_price: '200',
      fee_limit: '0',
    }
  },
  {
    merklex: 'ZRX-DAI',
    coinbase: 'ZRX-USD',
    value: '1.0',
    profit: '0.005',
    level_slope: '1.002',
    levels: 2,
    book_scale: '0.5',
    limit: {
      market: 'ZRX-DAI',
      min_quote: '-1000',
      min_base: '-10000',
      long_max_price: '1',
      short_min_price: '0.2',
      fee_limit: '0',
    }
  },
  // { merklex: 'BAT-DAI', coinbase: 'BAT-USD' },
];

const orderbooks = new CoinbasePro.OrderbookSync(markets.map(i => i.coinbase));
const merklex = new merkleX(settings.merklex);

const coinbase = new CoinbasePro.AuthenticatedClient(
  settings.coinbase.key,
  settings.coinbase.secret,
  settings.coinbase.pass,
  'https://api.pro.coinbase.com'
);

merklex.connect();
merklex.on('report', report => {
  if (report.type === 'Match') {
    console.log('%j', report);
  }
  else if (report.type === 'OrderDetails') {
    merklex.cancelOrder(report.order_token);
  }
  // console.log('got report %j', report);
});

// merklex.updateTradingLimit({
//    quote_asset_id: '1',
//    base_asset_id: '0',
//    fee_limit: '0',
//    min_quote_qty: '-10000000000',
//    min_base_qty: '-10000000000',
//    long_max_price: '100000000000000',
//    short_min_price: '1',
//    quote_shift: '0',
//    base_shift: '0',
// });


function updateLimit(market_symbol) {
  const market = markets.find(m => m.merklex === market_symbol);
  if (!market) {
    return Promise.reject(new Error('could not find market: ' + market_symbol));
  }

  return merklex.updateTradingLimit(market.limit);
}

const NO_ORDER = Promise.resolve({ order_token: 0 });

const replication = {};
markets.forEach(market => {
  replication[market.merklex] = {
    [true]: {},
    [false]: {},
  };
});

function collectOrders(side, remaining, book_scale) {
  const orders = [];

  for (let i = 0; i < side.length; ++i) {
    const level = side[i];
    const price = Big(level.price);
    const size = Big(level.size).mul(book_scale);

    const value = price.mul(size);

    Big.DP = 8;
    orders.push({
      price: Big(level.price),
      quantity: remaining.gt(value) ? size : remaining.div(price),
    });

    remaining = remaining.sub(value);
    if (remaining.lte(0)) {
      break;
    }
  }

  return orders;
}

function formLevels(orders, count) {
  if (orders.length === 0 || orders.length === count) {
    return orders;
  }

  if (orders.length < count) {
    const last_order_idx = orders.length - 1;
    const last_order = orders[last_order_idx];

    const split = count - last_order_idx;
    Big.DP = 8;

    last_order.quantity = last_order.quantity.div(split);

    for (let i = orders.length; i < count; ++i) {
      orders.push({
        ...last_order,
      });
    }

    return orders;
  }

  const extra = orders.count - count;
  const last_order = orders[count - 1];

  for (let i = count; i < orders.length; ++i) {
    last_order.price = orders[i].price;
    last_order.quantity = last_order.quantity.add(orders[i].quantity);
  }

  return orders.slice(0, count);
}

function replaceWithOrder(order, idx) {
  const R = replication[order.market][order.is_buy];

  const existing = R[idx] || NO_ORDER;
  R[idx] = new Promise(resolve => existing.then(resolve))
    .then(report => {
      if (report.order_token !== 0 && Big(report.price).eq(order.price)) {
        return report;
      }

      console.log('replace', report.price, 'with', order.price);

      order.replace_order_token = report.order_token;
      return merklex.newOrder(order);
    })
    .catch(err => {
      console.error('failed to place order %j', err.report);
      return existing;
    });
}

function run() {
  setInterval(() => {
    markets.forEach(market => {
      const book_state = orderbooks.books[market.coinbase].state();

      const buy_orders = formLevels(
        collectOrders(book_state.bids, Big(market.value), market.book_scale),
        market.levels
      );
      const sell_orders = formLevels(
        collectOrders(book_state.asks, Big(market.value), market.book_scale),
        market.levels,
      );

      buy_orders.forEach((order, idx) => {
        const spread = Big(1).sub(market.profit).div(Big(market.level_slope).pow(idx));
        order.market = market.merklex;
        order.price = order.price.mul(spread).toPrecision(5);
        order.quantity = order.quantity.toFixed(8);
        order.is_buy = true;

        replaceWithOrder(order, idx);
      });

      sell_orders.forEach((order, idx) => {
        const spread = Big(1).add(market.profit).mul(Big(market.level_slope).pow(idx));
        order.market = market.merklex;
        order.price = order.price.mul(spread).toPrecision(5);
        order.quantity = order.quantity.toFixed(8);
        order.is_buy = false;

        replaceWithOrder(order, idx);
      });
    });
  }, 1000);
}

setTimeout(run, 3000);
