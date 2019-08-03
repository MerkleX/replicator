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
};

module.exports = Coinbase;
