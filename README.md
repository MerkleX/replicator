

```
const merkleX = require('./exchange/merkleX');
const coinbase = require('./exchange/coinbase');
const replicator = require('./replicator');

const market = {
  market: 'merkleX',
  source: {
    exchange: coinbase,
    market: 'DAI-USDC',
    quote: 'USDC',
    base: 'DAI',
  },
  price_adjust: '1',
  base: {
    max_value: '300',
    target_value: '100',
    scale: '0.25',
    level: 2,
    spread: '0.005',
  }
}

replicator.run([market]);
```
