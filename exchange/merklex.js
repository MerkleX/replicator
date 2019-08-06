const merkleX = require('merklex');

class MerkleX {
  constructor(settings) {
    this._api = new merkleX(settings);
    this._onReport = this._onReport.bind(this);
    this._api.on('report', this._onReport);

    this._unhandled_matches = [];
    this._unhandled_order_details = [];
  }

  _onReport(report) {
    if (report.type === 'OrderDetails') {
      if (this._on_order_details) {
        this._on_order_details(report);
      }
      else {
        this._unhandled_order_details.push(report);
      }
    }
    else if (report.type === 'Match') {
      if (+report.sequence /* not self trade */) {
        if (this._on_match) {
          this._on_match(report);
        }
        else {
          this._unhandled_matches.push(report);
        }
      }
    }
  }

  newOrder(order) {
    return this._api.newOrder(order)
      .then(report => {
        report.timestamp = Date.now();
        return report;
      });
  }

  cancelOrder(order) {
    return this._api.cancelOrder(order.order_token);
  }

  handleOrderDetails(fn) {
    this._on_order_details = fn;
    this._unhandled_order_details.forEach(fn);
    this._unhandled_order_details = [];
  }

  handleMatch(fn) {
    this._on_match = fn;
    this._unhandled_matches.forEach(fn);
    this._unhandled_matches = [];
  }
}

module.exports = MerkleX;
