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
    buy_value: '500.0',
    sell_value: '100.0',
    buy_max: '100',
    sell_max: '100',
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
    sell_max: '200',
    buy_max: '300',
    profit: '0.005',
    level_slope: '1.002',
    levels: 3,
    book_scale: '0.25',
    replay: true,
    buy_price: null,
    cb_base_currency: 'BAT',
    cb_quote_currency: 'USDC',
  },
  {
    merklex: 'WETH-DAI',
    coinbase: 'ETH-USD',
    price_adjust: '1',
    buy_value: '600.0',
    sell_value: '300.0',
    sell_max: '300',
    buy_max: '300',
    profit: '0.005',
    level_slope: '1.002',
    levels: 3,
    book_scale: '0.25',
    replay: true,
    buy_price: null,
    cb_base_currency: 'ETH',
    cb_quote_currency: 'USD',
  },
  {
    merklex: 'ZRX-DAI',
    coinbase: 'ZRX-USD',
    price_adjust: '1',
    buy_value: '50.0',
    sell_value: '2.0',
    sell_max: '250',
    buy_max: '300',
    profit: '0.005',
    level_slope: '1.002',
    levels: 3,
    book_scale: '0.5',
    replay: true,
    buy_price: null,
    cb_base_currency: 'ZRX',
    cb_quote_currency: 'USD',
  },
  {
    merklex: '0xBTC-DAI',
    coinbase: 'BTC-USD',
    price_adjust: '0.000025',
    buy_value: '200.0',
    sell_value: '1000.0',
    buy_max: '300',
    profit: '0.01',
    level_slope: '1.002',
    levels: 4,
    book_scale: '1',
  },
];

const replication = {};
markets.forEach(market => {
  replication[market.merklex] = {
    [true]: {},
    [false]: {},
  };
});

let orderbooks = new CoinbasePro.OrderbookSync(markets.map(i => i.coinbase));
const merklex = new merkleX(settings.merklex);

const coinbase = new CoinbasePro.AuthenticatedClient(
  settings.coinbase.key,
  settings.coinbase.secret,
  settings.coinbase.pass,
  'https://api.pro.coinbase.com'
);

const pending_amount = {};

function getPending(market, is_buy) {
  const res = pending_amount[market.coinbase] && pending_amount[market.coinbase][is_buy];
  if (res) {
    return res;
  }

  if (!pending_amount[market.coinbase]) {
    pending_amount[market.coinbase] = {};
  }

  const r = pending_amount[market.coinbase][is_buy] = {
    size: Big(0),
    funds: Big(0),
  };
  return r;
}

const ZERO = Big(0);

merklex.connect();
merklex.on('report', report => {
  if (report.type === 'Match') {
    console.log('%j', report);

    const market = markets.find(m => m.merklex === report.market);
    if (market && market.replay && +report.sequence /* not self trade */) {
      if (report.is_buy) {
        Big.RM = 3; // round up

        const report_funds = Big(report.quantity).mul(report.price).mul('1.003');

        const P = getPending(market, true);
        const size = P.size = P.size.add(report.quantity);
        const funds = P.funds = P.funds.add(report_funds);

        P.size = ZERO;
        P.funds = ZERO;

        coinbase.placeOrder({
          product_id: market.coinbase,
          side: 'sell',
          type: 'market',
          size: size.toFixed(8),
          funds: funds.toFixed(2),
        }).catch(err => {
          console.log('error', Object.keys(err));
          // if (err.statusCode === 400) {
            P.size = P.size.add(size);
            P.funds = P.funds.add(funds);
            return;
          // }
          // console.error(err);
        });
      }
      else {
        Big.RM = 0; // round down

        const report_funds = Big(report.quantity).mul(report.price);
        const P = getPending(market, true);
        const funds = P.funds = P.funds.add(report_funds).mul('1.003');

        P.funds = ZERO;

        coinbase.placeOrder({
          product_id: market.coinbase,
          side: 'buy',
          type: 'market',
          funds: funds.toFixed(2),
        }).catch(err => {
          console.log('error', Object.keys(err));
          // if (err.statusCode === 400) {
            P.funds = P.funds.add(funds);
            return;
          // }
          // console.error(err);
        });
      }

      console.log('REPLAY TRADE');
    }
  }
  else if (report.type === 'OrderDetails') {
    merklex.cancelOrder(report.order_token);
  }
  else if (report.type === 'OrderDone') {
    const R = replication[report.market] && replication[report.market][report.is_buy];
    if (R) {
      Object.keys(R).forEach(idx => {
        const p = R[idx];
        p.then(old => {
          if (old.order_token === report.order_token && p === R[idx]) {
            delete R[idx];
          }
        });
      });
    }
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
        const age = Date.now() - (report.timestamp || 0);
        const quant_diff = Big(order.quantity).sub(report.quantity).abs();
        const is_small_diff = quant_diff.lt(Big(report.quantity).mul('0.2'));

        if (is_small_diff && age < 10000 && Big(report.price).eq(order.price)) {
          return report;
        }

        console.log('replace', order.market, order.is_buy, idx, report.price, 'with', order.price);
      }
      else {
        console.log('new order', order.market, order.is_buy, idx, 'at', order.price);
      }

      order.replace_order_token = report.order_token;
      return merklex.newOrder(order)
        .then(report => {
          report.timestamp = Date.now();
          return report;
        });
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
  /* update 0xBTC price */
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

        Big.DP = 6;
        market.price_adjust = Big(details.highestBid).add(details.lowestAsk).div(2);
        // const spread = Big(details.lowestAsk).sub(details.highestBid).div(details.highestBid).add('0.001');
        // market.profit = spread;
      });
  });

  /* update buy / sell value based on available funds */
  repeat(5000, 2500, () => {
    return coinbase.getAccounts().then(accounts => {
      markets.forEach(market => {
        if (!market.replay) {
          return;
        }

        const base_wallet = accounts.find(a => a.currency === market.cb_base_currency);
        if (!base_wallet) {
          console.error('could not find CB base_wallet for', market.cb_base_currency);
          return;
        }

        if (!market.buy_price) {
          console.error(market.merklex, 'buy price is not set');
          return;
        }

        const balance = Big(base_wallet.available);
        market.buy_value = balance.mul(market.buy_price) + '';
        console.log('set buy value', market.merklex, market.buy_value);
      });

      markets.forEach(market => {
        if (!market.replay) {
          return;
        }

        const quote_wallet = accounts.find(a => a.currency === market.cb_quote_currency);
        if (!quote_wallet) {
          console.error('could not find CB quote_wallet for', market.cb_quote_currency);
          return;
        }

        market.sell_value = quote_wallet.available;
        console.log('set sell value', market.merklex, market.sell_value);
      });
    });
  });

  let errors = {};

  const MAX_ERRORS = 500 * 3;
  const RELOAD_ERRORS = 100 * 3;

  const error = market_id => {
    errors[market_id] = (errors[market_id] || 0) + 1;
    if (errors[market_id] >= MAX_ERRORS) {
      console.log(market_id, 'book is crossed ' + MAX_ERRORS + ' times');
      process.exit(1);
    }

    if (errors[market_id] >= RELOAD_ERRORS) {
      console.log('reload orderbook due to error with', market_id);
      orderbooks.disconnect();
      orderbooks = null;

      const updated = new CoinbasePro.OrderbookSync(markets.map(i => i.coinbase));
      updated.on('open', () => {
        orderbooks = updated;
        errors = {};
      });
    }
  };

  setInterval(() => {
    markets.forEach(market => {
      if (!orderbooks) {
        console.log('orderbooks not yet connected');
        return;
      }

      const book = orderbooks.books[market.coinbase];
      if (!book) {
        console.log('book not loaded');
        error(market.coinbase);
        return;
      }

      const book_state = book.state();

      if (!book_state) {
        console.log('book state not loaded');
        error(market.coinbase);
        return;
      }

      if (!book_state.bids.length || !book_state.asks.length) {
        console.log('missing orders in book');
        error(market.coinbase);
        return;
      }

      let buy_value = Big(market.buy_value);
      if (market.buy_max && buy_value.gt(market.buy_max)) {
        buy_value = Big(market.buy_max);
      }

      const buy_orders = formLevels(
        collectOrders(book_state.bids, Big(buy_value), market.book_scale, market.price_adjust),
        market.levels
      );

      let sell_value = Big(market.sell_value);
      if (market.sell_max && sell_value.gt(market.sell_max)) {
        sell_value = Big(market.sell_max);
      }

      const sell_orders = formLevels(
        collectOrders(book_state.asks, sell_value, market.book_scale, market.price_adjust),
        market.levels,
      );

      buy_orders.forEach((order, idx) => {
        const spread = Big(1).sub(market.profit).div(Big(market.level_slope).pow(idx));
        order.market = market.merklex;
        order.price = order.price.mul(spread).toPrecision(5);
        order.quantity = order.quantity.toFixed(8);
        order.is_buy = true;
      });

      sell_orders.forEach((order, idx) => {
        const spread = Big(1).add(market.profit).mul(Big(market.level_slope).pow(idx));
        order.market = market.merklex;
        order.price = order.price.mul(spread).toPrecision(5);
        order.quantity = order.quantity.toFixed(8);
        order.is_buy = false;
      });

      if (buy_orders.length) {
        market.buy_price = buy_orders[0].price;
      }

      /* order buys and sell placement to prevent self-trading */
      let i = 0;
      for (i = 0; i < Math.min(buy_orders.length, sell_orders.length); ++i) {
        replaceWithOrder(sell_orders[i], i);
        replaceWithOrder(buy_orders[i], i);
      }

      for (i = 0; i < sell_orders.length; ++i) {
        replaceWithOrder(sell_orders[i], i);
      }

      for (i = 0; i < buy_orders.length; ++i) {
        replaceWithOrder(buy_orders[i], i);
      }

      if (Big(book_state.bids[0].price).gt(book_state.asks[0].price)) {
        console.log(market.coinbase, 'book crossed');
        error(market.coinbase);
      }
      else {
        errors[market] = 0;
      }
    });
  }, 300);
}

setTimeout(run, 1000);
