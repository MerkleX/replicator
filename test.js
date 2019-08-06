const CoinbaseBaseOrderBook = require('./lib/cb_orderbook');

const book = new CoinbaseBaseOrderBook(['ETH-USD']);

setInterval(() => {
  let levels_left = 5;

  book.read_orderbook('ETH-USD', 'sell', level => {
    console.log('level', level);

    levels_left--;
    return levels_left <= 0;
  });

  console.log('\n\n');
});
