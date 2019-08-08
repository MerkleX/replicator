const merkleX = require('merklex');

class MerkleX {
  constructor(settings) {
    this._api = new merkleX(settings);
    this._onReport = this._onReport.bind(this);
    this._api.on('report', this._onReport);

    this._unhandled_matches = [];
  }

  connect() {
    return this._api.connect();
  }

  _onReport(report) {
    if (report.type === 'Match') {
      if (+report.sequence /* not self trade */) {
        if (this._on_match) {
          this._on_match(report);
        } else {
          this._unhandled_matches.push(report);
        }
      }
    }
  }

  getResting() {
    return Promise.resolve(this._api.orders);
  }

  getBalances() {
    const balances = this._api.getBalances();
    const res = {};
    balances.forEach(b => {
      res[b.symbol] = b;
    });
    return Promise.resolve(res);
  }

  newOrder(order) {
    const a = this._api.newOrder(order);
    a.timestamp = Date.now();
    return a;
  }

  cancelOrder(order) {
    return this._api.cancelOrder(order.order_token);
  }

  handleMatch(fn) {
    this._on_match = fn;
    this._unhandled_matches.forEach(fn);
    this._unhandled_matches = [];
  }
}

module.exports = MerkleX;
