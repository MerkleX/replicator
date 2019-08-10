const settings = require('./settings');
const MerkleX = require('./exchange/merklex');
const Coinbase = require('./exchange/coinbase');
const Uniswap = require('./exchange/uniswap');
const Replicator = require('./replicator');

const coinbase = new Coinbase(settings.coinbase);
const merklex = new MerkleX(settings.merklex);
const uniswap = new Uniswap(settings.uniswap);

const sources = [
  {
    market: 'DAI-USDC',
    rebalance: true,
    exchange: {
      iface: coinbase,
      market: 'DAI-USDC',
      quote: 'USDC',
      base: 'DAI',
      fees: '0.003',
      price_decimals: 2,
    },
    base: {
      value_limits: {
        simple: '50',
      },
    }
  },
  {
    market: 'BAT-DAI',
    rebalance: true,
    exchange: {
      iface: coinbase,
      market: 'BAT-USDC',
      quote: 'USDC',
      base: 'BAT',
      fees: '0.003',
      price_decimals: 2,
    },
    base: {
      value_limits: {
        simple: '100',
      },
    }
  },
  {
    market: 'ETH-DAI',
    rebalance: true,
    exchange: {
      iface: coinbase,
      market: 'ETH-USD',
      quote: 'USD',
      base: 'ETH',
      fees: '0.003',
      price_decimals: 2,
    },
    buy: {
      value_limits: {
        simple: '300',
      },
    },
    sell: {
      quantity_limits: {
        simple: '8',
      },
    }
  },
  {
    market: 'ZRX-DAI',
    rebalance: true,
    exchange: {
      iface: coinbase,
      market: 'ZRX-USD',
      quote: 'USD',
      base: 'ZRX',
      fees: '0.003',
      price_decimals: 2,
    },
    base: {
      value_limits: {
        simple: '300',
      },
    },
    sell: {
      value_limits: {
        simple: '100',
      },
    }
  },
  {
    market: '0xBTC-DAI',
    rebalance: false,
    exchange: {
      iface: uniswap,
      market: '0xBTC-DAI',
      quote: 'DAI',
      base: '0xBTC',
      fees: '0.003',
      price_decimals: 6,
    },
    base: {
      book_scale: '0.5',
      value_limits: {
        simple: '800',
      },
    }
  },
  {
    market: 'REP-DAI',
    rebalance: true,
    exchange: {
      iface: coinbase,
      market: 'REP-USD',
      quote: 'USD',
      base: 'REP',
      fees: '0.003',
      price_decimals: 2,
    },
    base: {
      value_limits: {
        simple: '100',
      },
    },
    sell: {
      value_limits: {
        simple: '3'
      }
    }
  }
];

coinbase.subscribeMarkets(sources.filter(s => s.exchange.iface === coinbase).map(s => s.exchange.market));
uniswap.subscribeMarkets(sources.filter(s => s.exchange.iface === uniswap).map(s => s.exchange.market));

const r = new Replicator(merklex, sources);

function timeout(time) {
  return new Promise(resolve => {
    setTimeout(resolve, time);
  });
}

merklex.connect().then(() => timeout(1000)).then(() => {
  return Promise.all([
    r.refreshResting(),
    r.refreshSourceBalances(),
    r.refreshTargetBalances(),
    timeout(1000),
  ]);
}).then(() => {
  setInterval(() => {
    r.refreshSourceBalances();
    r.refreshTargetBalances();
  }, 3000);

  setInterval(() => {
      r.refreshOrders();
  }, 100);
});

