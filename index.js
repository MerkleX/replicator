const settings = require('./settings');
const merkleX = require('merklex');
const CoinbasePro = require('coinbase-pro');
const Big = require('big.js');
const requests = require('superagent');

const markets = [
  {
    merklex: 'DAI-USDC',
    coinbase: 'DAI-USDC',
    price_adjust: '1',
    buy_value: '100.0',
    sell_value: '100.0',
    profit: '0.005',
    level_slope: '1.0001',
    levels: 2,
    book_scale: '0.25',
  },
  {
    merklex: 'BAT-DAI',
    coinbase: 'BAT-USDC',
    price_adjust: '1',
    buy_value: '50.0',
    sell_value: '2.0',
    profit: '0.005',
    level_slope: '1.002',
    levels: 3,
    book_scale: '0.25',
  },
  {
    merklex: 'WETH-DAI',
    coinbase: 'ETH-USD',
    price_adjust: '1',
    buy_value: '600.0',
    sell_value: '300.0',
    profit: '0.005',
    level_slope: '1.002',
    levels: 3,
    book_scale: '0.25',
  },
  {
    merklex: 'ZRX-DAI',
    coinbase: 'ZRX-USD',
    price_adjust: '1',
    buy_value: '50.0',
    sell_value: '2.0',
    profit: '0.005',
    level_slope: '1.002',
    levels: 3,
    book_scale: '0.5',
  },
  {
    merklex: '0xBTC-DAI',
    coinbase: 'BTC-USD',
    price_adjust: '0.000025',
    buy_value: '200.0',
    sell_value: '1000.0',
    profit: '0.01',
    level_slope: '1.002',
    levels: 4,
    book_scale: '1',
  //  limit: {
  //    market: '0xBTC-DAI',
  //    min_quote: '-1000',
  //    min_base: '-10000',
  //    long_max_price: '1',
  //    short_min_price: '0.2',
  //    fee_limit: '0',
  //  }
  },
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
//    min_quote_qty: '-10000.000000',
//    min_base_qty: '-100.0000000',
//    long_max_price: '1000000.000000000',
//    short_min_price: '.00000001',
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

function collectOrders(side, remaining, book_scale, price_adjust) {
  const orders = [];

  for (let i = 0; i < side.length; ++i) {
    const level = side[i];
    const price = Big(level.price).mul(price_adjust);
    Big.DP = 8;
    const size = Big(level.size).mul(book_scale).div(price_adjust);

    const value = price.mul(size);

    Big.DP = 8;
    orders.push({
      price,
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
      if (report.order_token !== 0) {
        const quant_diff = Big(order.quantity).sub(report.quantity).abs();
        if (quant_diff.lt(Big(report.quantity).mul('0.2')) && Big(report.price).eq(order.price)) {
          return report;
        }

        console.log('replace', order.market, order.is_buy, idx, report.price, 'with', order.price);
      }
      else {
        console.log('new order', order.market, order.is_buy, idx, 'at', order.price);
      }

      order.replace_order_token = report.order_token;
      return merklex.newOrder(order);
    })
    .catch(err => {
      if (err.report && err.request) {
        console.error('failed to place order %j %j', err.report.reason, err.request);
      }
      else {
        console.error(err);
      }
      return existing;
    });
}

function repeat(success_timeout, fail_timeout, fn) {
  let tid

  function run() {
    fn().then(() => {
      tid = setTimeout(run, success_timeout);
    }).catch(err => {
      tid = setTimeout(run, fail_timeout);
      console.error(err);
    });
  }

  run();

  return () => {
    clearTimeout(tid);
  };
}

function run() {
  repeat(10000, 5000, () => {
    return requests.get('https://mercatox.com/public/json24')
      .then(res => JSON.parse(res.text))
      .then(data => {
        return data.pairs['0xBTC_BTC'];
      })
      .then(details => {
        const market = markets.find(m => m.merklex === '0xBTC-DAI');
        if (!market) {
          throw new Error('market not found');
        }

        market.price_adjust = details.highestBid;
      });
  });

  setTimeout(() => {
    setInterval(() => {
      markets.forEach(market => {
        const book_state = orderbooks.books[market.coinbase].state();

        const buy_orders = formLevels(
          collectOrders(book_state.bids, Big(market.buy_value), market.book_scale, market.price_adjust),
          market.levels
        );
        const sell_orders = formLevels(
          collectOrders(book_state.asks, Big(market.sell_value), market.book_scale, market.price_adjust),
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
  }, 1000);
}

setTimeout(run, 3000);
