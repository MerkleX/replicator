const CoinbasePro = require('coinbase-pro');
const settings = require('./settings');
const Big = require('big.js');


const coinbase = new CoinbasePro.AuthenticatedClient(
  settings.coinbase.key,
  settings.coinbase.secret,
  settings.coinbase.pass,
  'https://api.pro.coinbase.com'
);

const markets = {};

function getMarket(order) {
  const m = markets[order.product_id];
  if (!m) {
    return markets[order.product_id] = {
      quote: Big(0),
      base: Big(0),
    };
  }
  return m;
}

coinbase.getOrders({ status: 'done' }).then(orders => {
  orders.forEach(order => {
    const m = getMarket(order);

    let quote;
    let base;

    if (order.is_buy) {
      quote = Big(0).sub(order.executed_value).add(order.fill_fees);
      base = Big(order.filled_size);
    }
    else {
      quote = Big(order.executed_value).sub(order.fill_fees);
      base = Big(0).sub(order.filled_size);
    }

    console.log((Date.now() - new Date(order.done_at)) / 1000, order.product_id, quote + '', base + '');

    m.quote = m.quote.add(quote);
    m.base = m.base.add(base);
  });

  console.log('----total----');

  Object.keys(markets).forEach(market => {
    console.log(market, markets[market].quote + '', markets[market].base + '');
  });
});

