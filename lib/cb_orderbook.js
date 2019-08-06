const WebSocket = require('ws');
const RBTree = require('bintrees').RBTree;
const ws = require('ws');

class OrderbookMaintainer {
  constructor(product_ids) {
    this._orderbook         = this._orderbook.bind(this);
    this._update_orderbook  = this._update_orderbook.bind(this);
    this._handle_snapshot   = this._handle_snapshot.bind(this);
    this._handle_l2update   = this._handle_l2update.bind(this);
    this._handle_message    = this._handle_message.bind(this);

    this._orderbooks = {};

    for (let pid of product_ids) {
      this._orderbooks[pid] = {
        bids: new RBTree((a, b) => b[0] - a[0]),
        asks: new RBTree((a, b) => a[0] - b[0]),
      }
    }

    const subscription = JSON.stringify({
      type: 'subscribe',
      product_ids,
      channels: [
        'level2',
      ]
    });

    const WS_URI = 'wss://ws-feed.pro.coinbase.com';

    const load = () => {
      if (this._close) {
        return;
      }

      this._ws = new WebSocket(WS_URI);
      this._ws.on('open', () => this._ws.send(subscription));
      this._ws.on('message', this._handle_message);
      this._ws.on('close', load);
    };

    load();
  }

  close() {
    this._close = true;
    this._ws.close();
  }

  _orderbook(msg) {
    return this._orderbooks[msg.product_id];
  }

  _update_orderbook(value, orderbook) {
    const has_quantity = +value[1];

    if (!has_quantity) {
      orderbook.remove(value);
    }
    else {
      const inserted = orderbook.insert(value);
  
      if (!inserted) {
        orderbook.remove(value);
        orderbook.insert(value);
      }
    }
  }

  _handle_snapshot(msg) {
      msg.bids.forEach(bid => this._update_orderbook(bid, this._orderbook(msg).bids));
      msg.asks.forEach(ask => this._update_orderbook(ask,  this._orderbook(msg).asks));
  }

  _handle_l2update(msg) {
    msg.changes.forEach((change) => {
      const updates = [ change[1], change[2] ];
  
      if (change[0] === 'buy') {
        this._update_orderbook(updates, this._orderbook(msg).bids);
      }
      else {
        this._update_orderbook(updates, this._orderbook(msg).asks);
      }
    });
  }

  _handle_message(message) {
    const msg = JSON.parse(message);

    if (msg.type === 'snapshot') {
      this._handle_snapshot(msg);
    }
    else if (msg.type === 'l2update') {
      this._handle_l2update(msg);
    }
  }

  checkForCross() {
    const book_keys = Object.keys(this._orderbooks);
    let books_crossed = false;

    for (let key of book_keys) {
      const book = this._orderbooks[key];
      books_crossed = +book.bids.max()[0] < +book.asks.min()[0];

      if (books_crossed) break;
    }

    return books_crossed;
  }

  read(product_id, side, fn) {
    if (!this._orderbooks[product_id]) {
      throw `You are not subscribed to ${product_id}.`;
    }

    const book_set = this._orderbooks[product_id];
    if (!book_set) {
      return;
    }

    const book = side === 'buy' ? book_set.bids : book_set.asks;
    const it = book.iterator();

    let item;
    while((item = it.next()) !== null) {
      if (fn(item)) {
        return;
      }
    }
  }
}

module.exports = OrderbookMaintainer;
