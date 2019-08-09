const settings = require('./settings');
const MerkleX = require('./exchange/merklex');
const Coinbase = require('./exchange/coinbase');
const Replicator = require('./replicator');
const requests = require('superagent');
const Big = require('big.js');

const coinbase = new Coinbase(settings.coinbase);
const merklex = new MerkleX(settings.merklex);

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
    price_adjust: '0.00002011',
    exchange: {
      iface: coinbase,
      market: 'BTC-USD',
      quote: 'USD',
      base: 'BTC',
      fees: '0.003',
      price_decimals: 2,
    },
    base: {
      value_limits: {
        simple: '10',
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

coinbase.subscribeMarkets(sources.map(s => s.exchange.market));

const r = new Replicator(merklex, sources);
const price_adjust_0xbtc = r.getSource('0xBTC-DAI');

function priceAdjust() {
  return requests.get('https://mercatox.com/public/json24')
    .then(res => JSON.parse(res.text))
    .then(data => {
      return data.pairs['0xBTC_BTC'];
    })
    .then(details => {
      Big.DP = 16;
      price_adjust_0xbtc.price_adjust = Big(details.highestBid).add(details.lowestAsk).div(2);
      // const spread = Big(details.lowestAsk).sub(details.highestBid).div(details.highestBid).add('0.001');
      // market.profit = spread;
    });
}

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
    priceAdjust();
  }, 3000);

  setInterval(() => {
      r.refreshOrders();
  }, 100);
});

