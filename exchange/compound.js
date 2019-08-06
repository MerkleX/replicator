const compoundabi = require('../lib/abi/compound.json');
const erc20abi = require('../lib/abi/erc20.json');
const Web3 = require('web3');
const Big = require('big.js');

class Compound {
  constructor(settings) {
    const { private_key, web3_provider } = settings;

    this._web3 = new Web3(web3_provider || 'https://cloudflare-eth.com');

    this._address = '0xd83776C240A165a3D330775e8d0A55622663B55b';

    if (private_key) {
      this._priv_key = Buffer.from(private_key, 'hex');
      this._address = privateToAddress(this._priv_key).toString('hex');
    }

    this._markets = {
      cDAI: {
        address: '0xf5dce57282a584d2746faf1593d3121fcac444dc',
        asset_address: '0x89d24a6b4ccb1b6faa2625fe562bdd9a23260359',
        asset_symbol: 'DAI',
        decimals: 8,
        asset_decimals: 18,
        state: {
          balances: {}
        },
      },
    };

    Object.keys(this._markets).forEach(key => {
      const market = this._markets[key];
      market.contract = new this._web3.eth.Contract(compoundabi, market.address);
      market.asset_contract = new this._web3.eth.Contract(erc20abi, market.asset_address);
    });
  }

  get name() {
    return 'compound';
  }

  _update() {
    return Promise.all(Object.keys(this._markets).map(key => {
      const market = this._markets[key];

      return Promise.all([
        market.contract.methods.balanceOf(this._address)
        .call().then(res => {
          Big.DP = market.decimals;
          const b = Big(res + '').div(Big(10).pow(Big.DP)).toFixed(Big.DP);
          market.state.balances[key] = {
            available: b,
            balance: b,
            hold: 0,
          };

        }),
        market.asset_contract.methods.balanceOf(this._address).call()
        .then(res => {
          Big.DP = market.asset_decimals;
          const b = Big(res + '').div(Big(10).pow(Big.DP)).toFixed(Big.DP);
          market.state.balances[market.asset_symbol] = {
            available: b,
            balance: b,
            hold: 0,
          };
        }),
      ]);
    }));
  }

  getBalances() {
    this._update();
  }

  subscribeMarkets(markets) {
  }

  readLevels(market, side, fn) {
  }

  newOrder(order) {
    if (order.is_buy) {
    }
  }
}

module.exports = Compound;

const compound = new Compound({});
compound.getBalances();
