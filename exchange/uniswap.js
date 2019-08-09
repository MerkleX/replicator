const {
  getMarketDetails,
  getTokenReserves,
  getTradeDetails,
  tradeTokensForExactTokensWithData,
  getExecutionDetails,
  TRADE_EXACT,
} = require('@uniswap/sdk');

const Big = require('big.js');
const Web3 = require('web3');
const {ecsign, privateToAddress} = require('ethereumjs-util');

const pWait = require('../lib/p_wait');
const repeat = require('../lib/repeat');
const erc20abi = require('../lib/abi/erc20.json');

const ZERO = Big(0);

const DEFAULT_ASSETS = {
  '0xBTC': '0xb6ed7644c69416d67b522e20bc294a9a9b405b31',
  'DAI': '0x89d24a6b4ccb1b6faa2625fe562bdd9a23260359',
  'BAT': '0x0d8775f648430679a709e98d2b0cb6250d2887ef',
  'WETH': '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
};

const DEFAULT_LEVELS = {
  'DAI': ['5', '10', '100', '200', '500', '1000', '5000']
};

class Uniswap {
  constructor(settings) {
    settings = settings || {};
    this._assets = settings.assets || DEFAULT_ASSETS;
    this._value_levels = settings.value_levels || DEFAULT_LEVELS;
    this._reserve = {};

    this._update = this._update.bind(this);
    this._stop_update = repeat(1000, 5000, this._update);

    if (settings.private_key) {
      this._web3 = new Web3(settings.web3_provider || 'https://cloudflare-eth.com');
      this._priv_key = Buffer.from(settings.private_key, 'hex');
      this._address = privateToAddress(this._priv_key).toString('hex');

      this._erc20 = {};
      Object.keys(this._assets).forEach(key => {
        this._erc20[key] = new this._web3.eth.Contract(erc20abi, this._assets[key])
      });
    }
  }

  static get name() {
    return 'uniswap';
  }

  _update() {
    const loads = Object.keys(this._reserve).map(symbol => {
      let p = this._reserve[symbol];
      if (p._resolved) {
        p = this._reserve[symbol] = pWait();
      }

      getTokenReserves(this._assets[symbol]).then(p._resolve);
      return p;
    });

    return Promise.all(loads);
  }

  getBalances() {
    const balances = {};
    return Promise.all(Object.keys(this._assets).map(symbol => {
      const erc20 = this._erc20[symbol];
      return erc20.methods.balanceOf(this._address).call().then(balance => {
        const b = balance + '';
        balances[symbol] = {
          available: b,
          hold: '0',
          balance: b,
        };
      });
    })).then(() => balances);
  }

  subscribeMarkets(markets) {
    const assets = {};
    markets.forEach(m => {
      const [base, quote] = m.split('-');
      assets[quote] = true;
      assets[base] = true;
    });

    Object.keys(assets).forEach(symbol => {
      if (!this._assets[symbol]) {
        console.error('could not find asset with symbol', symbol);
        return;
      }

      this._reserve[symbol] = pWait();
    });
  }

  readLevels(market, is_buy, fn) {
    is_buy = !is_buy;

    const [base_asset, quote_asset] = market.split('-');
    const quote_p = this._reserve[quote_asset];
    const base_p = this._reserve[base_asset];
    const levels = this._value_levels[quote_asset];

    if (!quote_p || !base_p || !levels) {
      console.error('missing details for readLevels');
      return;
    }

    Promise.all([quote_p, base_p]).then(([quote_r, base_r]) => {
      const market_details = is_buy
        ? getMarketDetails(quote_r, base_r)
        : getMarketDetails(base_r, quote_r);

      const mode = is_buy
        ? TRADE_EXACT.INPUT
        : TRADE_EXACT.OUTPUT;

      const quote_scale = Big(10).pow(quote_r.token.decimals);

      let level_ac = ZERO;
      let last_quant = ZERO;
      for (let i = 0; i < levels.length; ++i) {
        const level = quote_scale.mul(levels[i]);
        level_ac = level_ac.add(level);

        try {
          const data = getTradeDetails(mode, level_ac + '', market_details);
          const rate = is_buy
            ? data.executionRate.rateInverted
            : data.executionRate.rate;

          const quant_details = is_buy
            ? data.outputAmount
            : data.inputAmount;

          Big.DP = quant_details.token.decimals;
          const quant = Big(quant_details.amount).div(Big(10).pow(Big.DP));
          if (fn([rate + '', quant.sub(last_quant).toFixed(Big.DP)])) {
            break;
          }
          last_quant = quant;
        } catch (e) {
          break;
        }
      }
    });
  }

  newOrder(order) {
    const [base_asset, quote_asset] = order.symbol.split('-');
    const quote_p = this._reserve[quote_asset];
    const base_p = this._reserve[base_asset];

    Promise.all([quote_p, base_p]).then(([quote_r, base_r]) => {
      let trade_details;
      if (order.is_buy) {
        const quantity = Big(order.quantity).mul(Big(10).pow(base_r.token.decimals)).toFixed(0);
        trade_details = tradeTokensForExactTokensWithData(quote_r, base_r, quantity);
      }
      else {
        const cost = Big(order.quantity).mul(order.price).mul(Big(10).pow(quote_r.token.decimals)).toFixed(0);
        trade_details = tradeTokensForExactTokensWithData(base_r, quote_r, cost);
      }

      const sign_info = getExecutionDetails(trade_details);
      console.log(sign_info);
    });
  }
}

module.exports = Uniswap;

const settings = require('../settings');

const u = new Uniswap({
  private_key: settings.merklex.trade_private_key
});

// u.getBalances().then(res => {
//   console.log(res);
// });

u.subscribeMarkets(['0xBTC-DAI', 'BAT-DAI', 'WETH-DAI']);

u.newOrder({
  symbol: 'WETH-DAI',
  is_buy: false,
  price: '0.2',
  quantity: '10'
});

// u.readLevels('BAT-DAI', true, level => {
//   console.log(level);
// });

// const dai_reserves = getTokenReserves('0x89d24a6b4ccb1b6faa2625fe562bdd9a23260359');
// const zbtc_reserves = getTokenReserves('0xb6ed7644c69416d67b522e20bc294a9a9b405b31');
//
// Promise.all([dai_reserves, zbtc_reserves]).then(([dai, zbtc]) => {
//   const details = getMarketDetails(dai, zbtc);
//   const res = getTradeDetails(TRADE_EXACT.INPUT, '1000000000000000000', details);
//   console.log(JSON.stringify(res));
// });
