const {
  getMarketDetails,
  getTokenReserves,
  getTradeDetails,
  TRADE_EXACT,
} = require('@uniswap/sdk');

const Big = require('big.js');
const Web3 = require('web3');
const {Transaction} = require('ethereumjs-tx');
const {privateToAddress} = require('ethereumjs-util');

const repeat = require('../lib/repeat');
const erc20abi = require('../lib/abi/erc20.json');
const uniswapabi = require('../lib/abi/uniswap.json');

const ZERO = Big(0);

const DEFAULT_ASSETS = {
  '0xBTC': '0xb6ed7644c69416d67b522e20bc294a9a9b405b31',
  'DAI': '0x89d24a6b4ccb1b6faa2625fe562bdd9a23260359',
  'BAT': '0x0d8775f648430679a709e98d2b0cb6250d2887ef',
  'WETH': '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
};

const DEFAULT_LEVELS = {
  'DAI': ['10', '200', '500', '1000', '5000', '10000', '20000']
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

      this._uniswap = new this._web3.eth.Contract(uniswapabi);
    }
  }

  get name() {
    return 'uniswap';
  }

  _update() {
    const loads = Object.keys(this._reserve).map(symbol => {
      return getTokenReserves(this._assets[symbol]).then(r => {
        this._reserve[symbol] = r;
      });
    });

    return Promise.all(loads);
  }

  getBalances() {
    const balances = {};
    return Promise.all(Object.keys(this._assets).map(symbol => {
      const erc20 = this._erc20[symbol];
      const reserve = this._reserve[symbol];
      if (!reserve) {
        return null;
      }

      return erc20.methods.balanceOf(this._address).call().then(balance => {
        Big.DP = reserve.token.decimals;
        const b = Big(balance + '').div(Big(10).pow(Big.DP)).toFixed(Big.DP);

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

      this._reserve[symbol] = null;
    });
  }

  readLevels(market, is_buy, fn) {
    is_buy = !is_buy;

    const [base_asset, quote_asset] = market.split('-');
    const quote_r = this._reserve[quote_asset];
    const base_r = this._reserve[base_asset];
    const levels = this._value_levels[quote_asset];

    if (!quote_r || !base_r || !levels) {
      console.error('missing details for readLevels');
      return;
    }

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
  }

  newOrder(order) {
    if (!this._priv_key) {
      return Promise.reject(new Error('private key not set'));
    }

    const [base_asset, quote_asset] = order.market.split('-');
    const quote_r = this._reserve[quote_asset];
    const base_r = this._reserve[base_asset];

    if (!quote_r || !base_r) {
      return Promise.reject(new Error('reserves not loaded'));
    }

    const tx_info = {
      to: null,
      nonce: null,
      gasPrice: '500000000',
      gasLimit: null,
      value: '0x00',
      data: null,
    };

    const quantity = Big(order.quantity).mul(Big(10).pow(base_r.token.decimals)).toFixed(0);
    const value = Big(order.quantity).mul(order.price).mul(Big(10).pow(quote_r.token.decimals)).toFixed(0);

    if (order.is_buy) {
      tx_info.to = quote_r.exchange.address;
      tx_info.data = this._uniswap.methods.tokenToTokenSwapInput(
        /* tokens_bought */ value,
        /* max_tokens_sold */ Big(quantity).mul(0.6).toFixed(0),
        /* max_eth_sold */ '1',
        /* deadline */ Big(Date.now() / 1000 + 600).toFixed(0),
        /* token_addr */ base_r.token.address).encodeABI();
    } else {
      tx_info.to = base_r.exchange.address;
      tx_info.data = this._uniswap.methods.tokenToTokenSwapInput(
        /* tokens_sold */ quantity,
        /* min_tokens_bought */ Big(value).mul(0.6).toFixed(0),
        /* min_eth_bought */ '1',
        /* deadline */ Big(Date.now() / 1000 + 600).toFixed(0),
        /* token_addr */ quote_r.token.address).encodeABI();
    }

    return this.getNonce().then(nonce => {
      tx_info.nonce = nonce;
      tx_info.gasPrice = 5000000000;
      tx_info.gasLimit = 150000;
      const tx = new Transaction(tx_info);
      tx.sign(this._priv_key);
      return tx.serialize();
    }).then(res => {
      return this._web3.eth.sendSignedTransaction('0x' + res.toString('hex'));
    }).then(hash => {
      console.log(order, 'done', hash);
    }).catch(err => {
      console.error('failed to rebalance');
      throw err;
    })
  }

  getNonce() {
    if (this._next_nonce === undefined) {
      if (this._nonce_load) {
        return this._nonce_load.then(() => {
          return this._next_nonce++;
        });
      }

      return this._nonce_load = this._web3.eth.getTransactionCount(this._address).then(nonce => {
        this._next_nonce = +nonce;
        return nonce;
      });
    }

    return Promise.resolve(this._next_nonce++);
  }
}

module.exports = Uniswap;