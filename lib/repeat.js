function repeat(success_timeout, fail_timeout, fn) {
  let tid;

  function run() {
    fn().then(() => {
      tid = setTimeout(run, success_timeout);
    }).catch(err => {
      tid = setTimeout(run, fail_timeout);
      console.error(err);
    });
  }

  run();

  return () => {
    clearTimeout(tid);
  };
}

module.exports = repeat;