const CoinbasePro = require('coinbase-pro');
const CoinbaseBaseOrderBook = require('../lib/cb_orderbook');

class Coinbase {
  constructor(settings) {
    this._api = new CoinbasePro.AuthenticatedClient(
      settings.key,
      settings.secret,
      settings.pass,
      'https://api.pro.coinbase.com'
    );
  }

  get name() {
    return 'coinbase-pro';
  }

  getBalances() {
    return this._api.getAccounts().then(accounts => {
      const balances = {};

      accounts.forEach(a => {
        balances[a.currency] = {
          balance: a.balance,
          available: a.available,
          hold: a.hold,
        };
      });

      return balances;
    });
  }

  subscribeMarkets(markets) {
    if (this._orderbooks) {
      this._orderbooks.close();
    }
    this._orderbooks = new CoinbaseBaseOrderBook(markets);
  }

  readLevels(market, side, fn) {
    if (!this._orderbooks) {
      return;
    }

    this._orderbooks.read(market, side, fn);
  }

  newOrder(order) {
    return this._api.placeOrder({
      product_id: order.market,
      side: order.is_buy ? 'buy' : 'sell',
      type: 'limit',
      size: order.quantity,
      price: order.price
    }).then(res => {
      console.log('rebalance %j', res.body);
    });
  }
}

module.exports = Coinbase;
