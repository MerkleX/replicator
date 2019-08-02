const WebSocket = require('ws');
const RBTree = require('bintrees').RBTree;

class OrderbookMaintainer {
  constructor(product_ids) {
    this._orderbook         = this._orderbook.bind(this);
    this._update_orderbook  = this._update_orderbook.bind(this);
    this._handle_snapshot   = this._handle_snapshot.bind(this);
    this._handle_l2update   = this._handle_l2update.bind(this);
    this._handle_message    = this._handle_message.bind(this);
    this.check_for_cross    = this.check_for_cross.bind(this);
    this.read_orderbook     = this.read_orderbook.bind(this);

    this.orderbooks = {};

    for (let pid of product_ids) {
      this.orderbooks[pid] = {
        bids: new RBTree((a, b) => a[0] - b[0]),
        asks: new RBTree((a, b) => b[0] - a[0]),
      }
    }

    const subscription = JSON.stringify({
      type: 'subscribe',
      product_ids,
      channels: [
        'level2',
      ]
    });
  
    const ws = new WebSocket('wss://ws-feed.pro.coinbase.com');
    ws.on('open', () => ws.send(subscription));
    ws.on('message', this._handle_message);
  }

  _orderbook(msg) {
    return this.orderbooks[msg.product_id];
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

  check_for_cross() {
    const book_keys = Object.keys(this.orderbooks);
    let books_crossed = false;

    for (let key of book_keys) {
      const book = this.orderbooks[key];
      books_crossed = +book.bids.max()[0] < +book.asks.min()[0];

      if (books_crossed) break;
    }

    return books_crossed;
  }

  read_orderbook(product_id, side, fn) {
    if (!this.orderbooks[product_id]) {
      throw `You are not subscribed to ${product_id}.`;
    }

    const tid = setTimeout(() => {
      const book_set = this.orderbooks[product_id];
      const book = side === 'buy' ? book_set.bids : book_set.asks;
      const it = book.iterator();
      let item;
  
      while((item = it.next()) !== null) {
        fn(item);
      }

      clearTimeout(tid);
    }, 5000);
  }
}
