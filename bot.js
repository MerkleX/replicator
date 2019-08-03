

// const MerkleX = require('./exchange/merklex');
const Coinbase = require('./exchange/coinbase');
const Replicator = require('./replicator');

const coinbase = new Coinbase({});

const source = {
  market: 'DAI-USDC',
  exchange: {
    iface: coinbase,
    market: 'DAI-USDC',
    quote: 'USDC',
    base: 'DAI',
  },
}

coinbase.subscribeMarkets([source.exchange.market]);

const r = new Replicator({
  newOrder: order => {
    console.log('%j', order);
    return Promise.resolve({ ...order, order_token: 1 });
  }
}, [source]);

setInterval(() => {
  r.refresh();
}, 1000);
