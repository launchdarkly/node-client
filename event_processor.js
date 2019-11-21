const LRUCache = require('lrucache');
const request = require('request');
const EventSummarizer = require('./event_summarizer');
const UserFilter = require('./user_filter');
const errors = require('./errors');
const httpUtils = require('./utils/httpUtils');
const messages = require('./messages');
const stringifyAttrs = require('./utils/stringifyAttrs');
const wrapPromiseCallback = require('./utils/wrapPromiseCallback');

const userAttrsToStringifyForEvents = [ 'key', 'secondary', 'ip', 'country', 'email', 'firstName', 'lastName', 'avatar', 'name' ];

function EventProcessor(sdkKey, config, errorReporter, diagnosticsManager) {
  const ep = {};

  const userFilter = UserFilter(config),
    summarizer = EventSummarizer(config),
    userKeysCache = LRUCache(config.userKeysCapacity),
    mainEventsUri = config.eventsUri + '/bulk',
    diagnosticEventsUri = config.eventsUri + '/diagnostic';
  
  let queue = [],
    lastKnownPastTime = 0,
    droppedEvents = 0,
    deduplicatedUsers = 0,
    exceededCapacity = false,
    shutdown = false,
    flushTimer,
    flushUsersTimer,
    diagnosticsTimer;

  function enqueue(event) {
    if (queue.length < config.capacity) {
      queue.push(event);
      exceededCapacity = false;
    } else {
      if (!exceededCapacity) {
        exceededCapacity = true;
        config.logger.warn('Exceeded event queue capacity. Increase capacity to avoid dropping events.');
      }
      droppedEvents++;
    }
  }

  function shouldDebugEvent(event) {
    if (event.debugEventsUntilDate) {
      if (event.debugEventsUntilDate > lastKnownPastTime &&
        event.debugEventsUntilDate > new Date().getTime()) {
        return true;
      }
    }
    return false;
  }

  function makeOutputEvent(event) {
    switch (event.kind) {
    case 'feature': {
      const debug = !!event.debug;
      const out = {
        kind: debug ? 'debug' : 'feature',
        creationDate: event.creationDate,
        key: event.key,
        value: event.value,
        default: event.default,
        prereqOf: event.prereqOf
      };
      if (event.variation !== undefined && event.variation !== null) {
        out.variation = event.variation;
      }
      if (event.version) {
        out.version = event.version;
      }
      if (event.reason) {
        out.reason = event.reason;
      }
      if (config.inlineUsersInEvents || debug) {
        out.user = processUser(event);
      } else {
        out.userKey = getUserKey(event);
      }
      return out;
    }
    case 'identify':
      return {
        kind: 'identify',
        creationDate: event.creationDate,
        key: getUserKey(event),
        user: processUser(event)
      };
    case 'custom': {
      const out = {
        kind: 'custom',
        creationDate: event.creationDate,
        key: event.key
      };
      if (config.inlineUsersInEvents) {
        out.user = processUser(event);
      } else {
        out.userKey = getUserKey(event);
      }
      if (event.data !== null && event.data !== undefined) {
        out.data = event.data;
      }
      if (event.metricValue !== null && event.metricValue !== undefined) {
        out.metricValue = event.metricValue;
      }
      return out;
    }
    default:
      return event;
    }
  }

  function processUser(event) {
    const filtered = userFilter.filterUser(event.user);
    return stringifyAttrs(filtered, userAttrsToStringifyForEvents);
  }

  function getUserKey(event) {
    return event.user && String(event.user.key);
  }

  ep.sendEvent = event => {
    let addIndexEvent = false,
      addFullEvent = false,
      addDebugEvent = false;

    if (shutdown) {
      return;
    }

    // Always record the event in the summarizer.
    summarizer.summarizeEvent(event);

    // Decide whether to add the event to the payload. Feature events may be added twice, once for
    // the event (if tracked) and once for debugging.
    if (event.kind === 'feature') {
      addFullEvent = event.trackEvents;
      addDebugEvent = shouldDebugEvent(event);
    } else {
      addFullEvent = true;
    }

    // For each user we haven't seen before, we add an index event - unless this is already
    // an identify event for that user.
    if (!addFullEvent || !config.inlineUsersInEvents) {
      if (event.user) {
        const isIdentify = (event.kind === 'identify');
        if (userKeysCache.get(event.user.key)) {
          if (!isIdentify) {
            deduplicatedUsers++;
          }
        } else {
          userKeysCache.set(event.user.key, true);
          if (!isIdentify) {
            addIndexEvent = true;
          }
        }
      }
    }

    if (addIndexEvent) {
      enqueue({
        kind: 'index',
        creationDate: event.creationDate,
        user: processUser(event)
      });
    }
    if (addFullEvent) {
      enqueue(makeOutputEvent(event));
    }
    if (addDebugEvent) {
      const debugEvent = Object.assign({}, event, { debug: true });
      enqueue(makeOutputEvent(debugEvent));
    }
  };

  ep.flush = function(callback) {
    return wrapPromiseCallback(new Promise(function(resolve, reject) {
      let worklist;
      let summary;
      
      if (shutdown) {
        const err = new errors.LDInvalidSDKKeyError('Events cannot be posted because SDK key is invalid');
        reject(err);
        return;
      }

      worklist = queue;
      queue = [];
      summary = summarizer.getSummary();
      summarizer.clearSummary();
      if (Object.keys(summary.features).length) {
        summary.kind = 'summary';
        worklist.push(summary);
      }

      if (!worklist.length) {
        resolve();
        return;
      }

      config.logger.debug('Flushing %d events', worklist.length);

      tryPostingEvents(worklist, mainEventsUri, resolve, reject, true);
    }), callback);
  };

  function tryPostingEvents(events, uri, resolve, reject, canRetry) {
    const retryOrReject = err => {
      if (canRetry) {
        config.logger && config.logger.warn('Will retry posting events after 1 second');
        setTimeout(() => {
          tryPostingEvents(events, uri, resolve, reject, false);
        }, 1000);
      } else {
        reject(err);
      }
    };

    const headers = Object.assign({ 'X-LaunchDarkly-Event-Schema': '3' },
      httpUtils.getDefaultHeaders(sdkKey, config));

    const options = Object.assign({}, config.tlsParams, {
      method: 'POST',
      url: uri,
      headers,
      json: true,
      body: events,
      timeout: config.timeout * 1000,
      agent: config.proxyAgent
    });
    request(options).on('response', (resp, body) => {
      if (resp.headers['date']) {
        const date = Date.parse(resp.headers['date']);
        if (date) {
          lastKnownPastTime = date;
        }
      }
      if (resp.statusCode > 204) {
        const err = new errors.LDUnexpectedResponseError(messages.httpErrorMessage(resp.statusCode, 'event posting', 'some events were dropped'));
        errorReporter && errorReporter(err);
        if (!errors.isHttpErrorRecoverable(resp.statusCode)) {
          reject(err);
          shutdown = true;
        } else {
          retryOrReject(err);
        }
      } else {
        resolve(resp, body);
      }
    }).on('error', function(err) {
      retryOrReject(err);
    });
  }

  function postDiagnosticEvent(event) {
    tryPostingEvents(event, diagnosticEventsUri, () => {}, () => {}, true);
  }

  ep.close = () => {
    clearInterval(flushTimer);
    clearInterval(flushUsersTimer);
    diagnosticsTimer && clearInterval(diagnosticsTimer);
  };

  flushTimer = setInterval(() => {
    ep.flush().then(() => {} , () => {});
  }, config.flushInterval * 1000);

  flushUsersTimer = setInterval(() => {
    userKeysCache.removeAll();
  }, config.userKeysFlushInterval * 1000);

  if (!config.diagnosticOptOut && diagnosticsManager) {
    const initEvent = diagnosticsManager.createInitEvent();
    postDiagnosticEvent(initEvent);
    
    diagnosticsTimer = setInterval(() => {
      const statsEvent = diagnosticsManager.createStatsEventAndReset(droppedEvents, deduplicatedUsers, queue.length);
      droppedEvents = 0;
      deduplicatedUsers = 0;
      postDiagnosticEvent(statsEvent);
    }, config.diagnosticRecordingInterval * 1000);
  }

  return ep;
}

module.exports = EventProcessor;
