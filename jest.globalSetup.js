// Run every test in Irish time, whatever the machine's (or CI's) own time zone is, so date
// tests behave the same everywhere - including across summer-time switches.
// This must be globalSetup: it runs in Jest's main process before the test workers start, and
// the workers inherit TZ. Setting it in setupFiles would only change the sandbox's copy of process.env.
module.exports = async () => {
  process.env.TZ = 'Europe/Dublin';
};
