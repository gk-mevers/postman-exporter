const config = require('../config/config');
const newman = require('newman');
const promClient = require('prom-client');
const logger = require('../utils/logger');

const NAME_PREFIX = 'probe_pm_';

class Prober {

  constructor(req, res, probe) {
    this.req = req;
    this.res = res;
    this.probe = probe;
    this.options = config.probes[probe].options;

    // registry for the current probe
    this.probeRegistry = new promClient.Registry();
  }

  run() {
    newman.run(this.options)
      .on('start', (err, args) => {
        logger.debug(`collection run for probe '${this.probe}' started`);
      })
      .on('done', (err, summary) => {
        if (err || summary.error) {
          logger.error(`collection run for probe '${this.probe}' encountered an error`);
          this.summary = summary;
        }
        else {
          logger.debug(`collection run for probe '${this.probe}' completed`);
          if (this.req.query.debug === 'true') {
            // ToDo: allow to disable debug output as it may contain secrets
            logger.info(`return /probe/${this.probe} with debug=true`);
            return this.res.send(summary.run);
          }

          /**
           * set metrics
           */

          // probe success
          if (summary.run.failures.length) {
            new promClient.Gauge({
              name: NAME_PREFIX + 'success',
              help: 'Returns the probe success',
              registers: [this.probeRegistry]
            }).set(0);
          } else {
            new promClient.Gauge({
              name: NAME_PREFIX + 'success',
              help: 'Returns the probe success',
              registers: [this.probeRegistry]
            }).set(1);
          }

          // transfers
          new promClient.Gauge({
            name: NAME_PREFIX + 'transfers_response_bytes_total',
            help: 'Returns the transfers responseTotal',
            registers: [this.probeRegistry]
          }).set(summary.run.transfers.responseTotal);

          // stats
          for (const [key, value] of Object.entries(summary.run.stats)) {
            for (const [key2, value2] of Object.entries(value)) {
              logger.debug(`stats ${key} ${key2} ${value2}`);
              new promClient.Gauge({
                name: `${NAME_PREFIX}stats_${key}_${key2}`,
                help: `Returns the stats ${key} ${key2}`,
                registers: [this.probeRegistry]
              }).set(value2);
            }
          }

          // timings
          new promClient.Gauge({
            name: NAME_PREFIX + 'duration_seconds_total',
            help: 'Returns how long the run took to complete in seconds ((timings.completed - timings.started) / 1000)',
            registers: [this.probeRegistry]
          }).set((summary.run.timings.completed - summary.run.timings.started) / 1000);

          for (const [key, value] of Object.entries(summary.run.timings)) {
            logger.debug(`timings ${key} ${value}`);
            if (key === 'started') continue;
            if (key === 'completed') continue;
            new promClient.Gauge({
              name: `${NAME_PREFIX}timings_${key}_seconds`,
              help: `Returns the timings ${key} / 1000 (seconds)`,
              registers: [this.probeRegistry]
            }).set(value / 1000);
          }

          // failures
          new promClient.Gauge({
            name: NAME_PREFIX + 'failures_total',
            help: 'Returns the total failure count',
            registers: [this.probeRegistry]
          }).set(summary.run.failures.length);
          
          // ToDo:
          // loop over sumary.run.executions and add with labels?
          // * Request name
          // * HTTP Method
          // * URL (Creates lots of labels!, maybe without query parameters and otherwise shortened)
          // * Response code
          // * Response data received
          // * Response time
          // loop also over assertions?

          logger.info(`return /probe/${this.probe}`);
          this.res.send(this.probeRegistry.metrics());
        }
      });
  }
  
}

module.exports = Prober;