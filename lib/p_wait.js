const NO_OP = () => {};

module.exports = () => {
  let _resolve;
  let _reject;

  const p = new Promise((resolve, reject) => {
    _resolve = resolve;
    _reject = reject;
  });

  p._resolved = null;

  p._resolve = item => {
    p._resolve = NO_OP;
    p._reject = NO_OP;
    p._resolved = item;
    _resolve(item);
  };
  p._reject = err => {
    p._resolve = NO_OP;
    p._reject = NO_OP;
    p._resolved = true;
    p._error = err;
    _reject(err);
  };

  return p;
};