const EventProcessor = require('../event_processor');
const { sleepAsync, TestHttpHandlers, TestHttpServer, withCloseable } = require('launchdarkly-js-test-helpers');

describe('EventProcessor', () => {

  const eventsUri = 'http://example.com';
  const sdkKey = 'SDK_KEY';
  const defaultConfig = {
    eventsUri: eventsUri,
    capacity: 100,
    flushInterval: 30,
    userKeysCapacity: 1000,
    userKeysFlushInterval: 300,
    logger: {
      debug: jest.fn(),
      warn: jest.fn()
    }
  };
  const developmentConfig = {
    eventsUri: eventsUri,
    capacity: 100,
    flushInterval: 30,
    userKeysCapacity: 1000,
    userKeysFlushInterval: 300,
    inMemoryDevFlags: { 'development-feature': true },
    logger: {
      debug: jest.fn(),
      warn: jest.fn()
    }
  };
  const user = { key: 'userKey', name: 'Red' };
  const filteredUser = { key: 'userKey', privateAttrs: [ 'name' ] };
  const numericUser = { key: 1, secondary: 2, ip: 3, country: 4, email: 5, firstName: 6, lastName: 7,
    avatar: 8, name: 9, anonymous: false, custom: { age: 99 } };
  const stringifiedNumericUser = { key: '1', secondary: '2', ip: '3', country: '4', email: '5', firstName: '6',
    lastName: '7', avatar: '8', name: '9', anonymous: false, custom: { age: 99 } };

  function eventsServerTest(asyncCallback) {
    return async () => withCloseable(TestHttpServer.start, async server => {
      server.forMethodAndPath('post', '/bulk', TestHttpHandlers.respond(200));
      return await asyncCallback(server);
    });
  }

  async function withEventProcessor(config, server, asyncCallback) {
    const ep = EventProcessor(sdkKey, Object.assign({}, config, { eventsUri: server.url }));
    try {
      return await asyncCallback(ep);
    } finally {
      ep.close();
    }
  }

  function headersWithDate(timestamp) {
    return { date: new Date(timestamp).toUTCString() };
  }

  function checkIndexEvent(e, source, user) {
    expect(e.kind).toEqual('index');
    expect(e.creationDate).toEqual(source.creationDate);
    expect(e.user).toEqual(user);
  }

  function checkFeatureEvent(e, source, debug, inlineUser) {
    expect(e.kind).toEqual(debug ? 'debug' : 'feature');
    expect(e.creationDate).toEqual(source.creationDate);
    expect(e.key).toEqual(source.key);
    expect(e.version).toEqual(source.version);
    expect(e.variation).toEqual(source.variation);
    expect(e.value).toEqual(source.value);
    expect(e.default).toEqual(source.default);
    expect(e.reason).toEqual(source.reason);
    if (inlineUser) {
      expect(e.user).toEqual(inlineUser);
    } else {
      expect(e.userKey).toEqual(String(source.user.key));
    }
  }

  function checkCustomEvent(e, source, inlineUser) {
    expect(e.kind).toEqual('custom');
    expect(e.creationDate).toEqual(source.creationDate);
    expect(e.key).toEqual(source.key);
    expect(e.data).toEqual(source.data);
    expect(e.metricValue).toBe(source.metricValue);
    if (inlineUser) {
      expect(e.user).toEqual(inlineUser);
    } else {
      expect(e.userKey).toEqual(source.user.key);
    }
  }

  function checkSummaryEvent(e) {
    expect(e.kind).toEqual('summary');
  }

  async function getJsonRequest(server) {
    return JSON.parse((await server.nextRequest()).body);
  }

  it('queues identify event', eventsServerTest(async s => {
    await withEventProcessor(defaultConfig, s, async ep => {
      const e = { kind: 'identify', creationDate: 1000, user: user };
      ep.sendEvent(e);
      await ep.flush();

      const output = await getJsonRequest(s);
      expect(output).toEqual([{
        kind: 'identify',
        creationDate: 1000,
        key: user.key,
        user: user
      }]);
    });
  }));

  it('filters user in identify event', eventsServerTest(async s => {
    const config = Object.assign({}, defaultConfig, { allAttributesPrivate: true });
    await withEventProcessor(config, s, async ep => {
      const e = { kind: 'identify', creationDate: 1000, user: user };
      ep.sendEvent(e);
      await ep.flush();

      const output = await getJsonRequest(s);
      expect(output).toEqual([{
        kind: 'identify',
        creationDate: 1000,
        key: user.key,
        user: filteredUser
      }]);
    });
  }));

  it('stringifies user attributes in identify event', eventsServerTest(async s => {
    await withEventProcessor(defaultConfig, s, async ep => {
      const e = { kind: 'identify', creationDate: 1000, user: numericUser };
      ep.sendEvent(e);
      await ep.flush();

      const output = await getJsonRequest(s);
      expect(output).toEqual([{
        kind: 'identify',
        creationDate: 1000,
        key: stringifiedNumericUser.key,
        user: stringifiedNumericUser
      }]);
    });
  }));

  it('queues individual feature event with index event', eventsServerTest(async s => {
    await withEventProcessor(defaultConfig, s, async ep => {
      const e = { kind: 'feature', creationDate: 1000, user: user, key: 'flagkey',
        version: 11, variation: 1, value: 'value', trackEvents: true };
      ep.sendEvent(e);
      await ep.flush();

      const output = await getJsonRequest(s);
      expect(output.length).toEqual(3);
      checkIndexEvent(output[0], e, user);
      checkFeatureEvent(output[1], e, false);
      checkSummaryEvent(output[2]);
    });
  }));

  it('filters user in index event', eventsServerTest(async s => {
    const config = Object.assign({}, defaultConfig, { allAttributesPrivate: true });
    await withEventProcessor(config, s, async ep => {
      const e = { kind: 'feature', creationDate: 1000, user: user, key: 'flagkey',
        version: 11, variation: 1, value: 'value', trackEvents: true };
      ep.sendEvent(e);
      await ep.flush();

      const output = await getJsonRequest(s);
      expect(output.length).toEqual(3);
      checkIndexEvent(output[0], e, filteredUser);
      checkFeatureEvent(output[1], e, false);
      checkSummaryEvent(output[2]);
    });
  }));

  it('stringifies user attributes in index event', eventsServerTest(async s => {
    await withEventProcessor(defaultConfig, s, async ep => {
      const e = { kind: 'feature', creationDate: 1000, user: numericUser, key: 'flagkey',
        version: 11, variation: 1, value: 'value', trackEvents: true };
      ep.sendEvent(e);
      await ep.flush();

      const output = await getJsonRequest(s);
      expect(output.length).toEqual(3);
      checkIndexEvent(output[0], e, stringifiedNumericUser);
      checkFeatureEvent(output[1], e, false);
      checkSummaryEvent(output[2]);
    });
  }));

  it('can include inline user in feature event', eventsServerTest(async s => {
    const config = Object.assign({}, defaultConfig, { inlineUsersInEvents: true });
    await withEventProcessor(config, s, async ep => {
      const e = { kind: 'feature', creationDate: 1000, user: user, key: 'flagkey',
        version: 11, variation: 1, value: 'value', trackEvents: true };
      ep.sendEvent(e);
      await ep.flush();

      const output = await getJsonRequest(s);
      expect(output.length).toEqual(2);
      checkFeatureEvent(output[0], e, false, user);
      checkSummaryEvent(output[1]);
    });
  }));

  it('filters user in feature event', eventsServerTest(async s => {
    const config = Object.assign({}, defaultConfig, { allAttributesPrivate: true,
      inlineUsersInEvents: true });
    await withEventProcessor(config, s, async ep => {
      const e = { kind: 'feature', creationDate: 1000, user: user, key: 'flagkey',
        version: 11, variation: 1, value: 'value', trackEvents: true };
      ep.sendEvent(e);
      await ep.flush();

      const output = await getJsonRequest(s);
      expect(output.length).toEqual(2);
      checkFeatureEvent(output[0], e, false, filteredUser);
      checkSummaryEvent(output[1]);
    });
  }));

  it('processes offline events when defined', eventsServerTest(async s => {
    const config = Object.assign({}, developmentConfig, { allAttributesPrivate: true });
    await withEventProcessor(config, s, async ep => {
      const e = developmentConfig.inMemoryDevFlags['development-feature']
      ep.sendEvent(e);
      await ep.flush();

      const output = await getJsonRequest(s);
      expect(output.length).toEqual(1);
      expect(output[0]).toEqual(e)
    });
  }));

  it('stringifies user attributes in feature event', eventsServerTest(async s => {
    const config = Object.assign({}, defaultConfig, { inlineUsersInEvents: true });
    await withEventProcessor(config, s, async ep => {
      const e = { kind: 'feature', creationDate: 1000, user: numericUser, key: 'flagkey',
        version: 11, variation: 1, value: 'value', trackEvents: true };
      ep.sendEvent(e);
      await ep.flush();

      const output = await getJsonRequest(s);
      expect(output.length).toEqual(2);
      checkFeatureEvent(output[0], e, false, stringifiedNumericUser);
      checkSummaryEvent(output[1]);
    });
  }));

  it('can include reason in feature event', eventsServerTest(async s => {
    const config = Object.assign({}, defaultConfig, { inlineUsersInEvents: true });
    await withEventProcessor(config, s, async ep => {
      const e = { kind: 'feature', creationDate: 1000, user: user, key: 'flagkey',
        version: 11, variation: 1, value: 'value', trackEvents: true,
        reason: { kind: 'FALLTHROUGH' } };
      ep.sendEvent(e);
      await ep.flush();

      const output = await getJsonRequest(s);
      expect(output.length).toEqual(2);
      checkFeatureEvent(output[0], e, false, user);
      checkSummaryEvent(output[1]);
    });
  }));

  it('still generates index event if inlineUsers is true but feature event is not tracked', eventsServerTest(async s => {
    const config = Object.assign({}, defaultConfig, { inlineUsersInEvents: true });
    await withEventProcessor(config, s, async ep => {
      const e = { kind: 'feature', creationDate: 1000, user: user, key: 'flagkey',
        version: 11, variation: 1, value: 'value', trackEvents: false };
      ep.sendEvent(e);
      await ep.flush();

      const output = await getJsonRequest(s);
      expect(output.length).toEqual(2);
      checkIndexEvent(output[0], e, user);
      checkSummaryEvent(output[1]);
    });
  }));

  it('sets event kind to debug if event is temporarily in debug mode', eventsServerTest(async s => {
    await withEventProcessor(defaultConfig, s, async ep => {
      var futureTime = new Date().getTime() + 1000000;
      const e = { kind: 'feature', creationDate: 1000, user: user, key: 'flagkey',
        version: 11, variation: 1, value: 'value', trackEvents: false, debugEventsUntilDate: futureTime };
      ep.sendEvent(e);
      await ep.flush();

      const output = await getJsonRequest(s);
      expect(output.length).toEqual(3);
      checkIndexEvent(output[0], e, user);
      checkFeatureEvent(output[1], e, true, user);
      checkSummaryEvent(output[2]);
    });
  }));

  it('can both track and debug an event', eventsServerTest(async s => {
    await withEventProcessor(defaultConfig, s, async ep => {
      const futureTime = new Date().getTime() + 1000000;
      const e = { kind: 'feature', creationDate: 1000, user: user, key: 'flagkey',
        version: 11, variation: 1, value: 'value', trackEvents: true, debugEventsUntilDate: futureTime };
      ep.sendEvent(e);
      await ep.flush();

      const output = await getJsonRequest(s);
      expect(output.length).toEqual(4);
      checkIndexEvent(output[0], e, user);
      checkFeatureEvent(output[1], e, false);
      checkFeatureEvent(output[2], e, true, user);
      checkSummaryEvent(output[3]);
    });
  }));

  it('expires debug mode based on client time if client time is later than server time', eventsServerTest(async s => {
    await withEventProcessor(defaultConfig, s, async ep => {
      // Pick a server time that is somewhat behind the client time
      const serverTime = new Date().getTime() - 20000;
      s.forMethodAndPath('post', '/bulk', TestHttpHandlers.respond(200, headersWithDate(serverTime)));

      // Send and flush an event we don't care about, just to set the last server time
      ep.sendEvent({ kind: 'identify', user: { key: 'otherUser' } });
      await ep.flush();
      await s.nextRequest();

      // Now send an event with debug mode on, with a "debug until" time that is further in
      // the future than the server time, but in the past compared to the client.
      const debugUntil = serverTime + 1000;
      const e = { kind: 'feature', creationDate: 1000, user: user, key: 'flagkey',
        version: 11, variation: 1, value: 'value', trackEvents: false, debugEventsUntilDate: debugUntil };
      ep.sendEvent(e);
      await ep.flush();

      // Should get a summary event only, not a full feature event
      const output = await getJsonRequest(s);
      expect(output.length).toEqual(2);
      checkIndexEvent(output[0], e, user);
      checkSummaryEvent(output[1]);
    });
  }));

  it('expires debug mode based on server time if server time is later than client time', eventsServerTest(async s => {
    await withEventProcessor(defaultConfig, s, async ep => {
      // Pick a server time that is somewhat ahead of the client time
      const serverTime = new Date().getTime() + 20000;
      s.forMethodAndPath('post', '/bulk', TestHttpHandlers.respond(200, headersWithDate(serverTime)));

      // Send and flush an event we don't care about, just to set the last server time
      ep.sendEvent({ kind: 'identify', user: { key: 'otherUser' } });
      await ep.flush();
      await s.nextRequest();

      // Now send an event with debug mode on, with a "debug until" time that is further in
      // the future than the client time, but in the past compared to the server.
      const debugUntil = serverTime - 1000;
      const e = { kind: 'feature', creationDate: 1000, user: user, key: 'flagkey',
        version: 11, variation: 1, value: 'value', trackEvents: false, debugEventsUntilDate: debugUntil };
      ep.sendEvent(e);
      await ep.flush();

      // Should get a summary event only, not a full feature event
      const output = await getJsonRequest(s);
      expect(output.length).toEqual(2);
      checkIndexEvent(output[0], e, user);
      checkSummaryEvent(output[1]);
    });
  }));

  it('generates only one index event from two feature events for same user', eventsServerTest(async s => {
    await withEventProcessor(defaultConfig, s, async ep => {
      const e1 = { kind: 'feature', creationDate: 1000, user: user, key: 'flagkey1',
        version: 11, variation: 1, value: 'value', trackEvents: true };
      const e2 = { kind: 'feature', creationDate: 1000, user: user, key: 'flagkey2',
        version: 11, variation: 1, value: 'value', trackEvents: true };
      ep.sendEvent(e1);
      ep.sendEvent(e2);
      await ep.flush();

      const output = await getJsonRequest(s);
      expect(output.length).toEqual(4);
      checkIndexEvent(output[0], e1, user);
      checkFeatureEvent(output[1], e1, false);
      checkFeatureEvent(output[2], e2, false);
      checkSummaryEvent(output[3]);
    });
  }));

  it('summarizes nontracked events', eventsServerTest(async s => {
    await withEventProcessor(defaultConfig, s, async ep => {
      const e1 = { kind: 'feature', creationDate: 1000, user: user, key: 'flagkey1',
        version: 11, variation: 1, value: 'value1', default: 'default1', trackEvents: false };
      const e2 = { kind: 'feature', creationDate: 2000, user: user, key: 'flagkey2',
        version: 22, variation: 1, value: 'value2', default: 'default2', trackEvents: false };
      ep.sendEvent(e1);
      ep.sendEvent(e2);
      await ep.flush();

      const output = await getJsonRequest(s);
      expect(output.length).toEqual(2);
      checkIndexEvent(output[0], e1, user);
      const se = output[1];
      checkSummaryEvent(se);
      expect(se.startDate).toEqual(1000);
      expect(se.endDate).toEqual(2000);
      expect(se.features).toEqual({
        flagkey1: {
          default: 'default1',
          counters: [ { version: 11, variation: 1, value: 'value1', count: 1 } ]
        },
        flagkey2: {
          default: 'default2',
          counters: [ { version: 22, variation: 1, value: 'value2', count: 1 } ]
        }
      });
    });
  }));

  it('queues custom event with user', eventsServerTest(async s => {
    await withEventProcessor(defaultConfig, s, async ep => {
      const e = { kind: 'custom', creationDate: 1000, user: user, key: 'eventkey',
        data: { thing: 'stuff' } };
      ep.sendEvent(e);
      await ep.flush();

      const output = await getJsonRequest(s);
      expect(output.length).toEqual(2);
      checkIndexEvent(output[0], e, user);
      checkCustomEvent(output[1], e);
    });
  }));

  it('can include metric value in custom event', eventsServerTest(async s => {
    await withEventProcessor(defaultConfig, s, async ep => {
      const e = { kind: 'custom', creationDate: 1000, user: user, key: 'eventkey',
        data: { thing: 'stuff' }, metricValue: 1.5 };
      ep.sendEvent(e);
      await ep.flush();

      const output = await getJsonRequest(s);
      expect(output.length).toEqual(2);
      checkIndexEvent(output[0], e, user);
      checkCustomEvent(output[1], e);
    });
  }));

  it('can include inline user in custom event', eventsServerTest(async s => {
    const config = Object.assign({}, defaultConfig, { inlineUsersInEvents: true });
    await withEventProcessor(config, s, async ep => {
      const e = { kind: 'custom', creationDate: 1000, user: user, key: 'eventkey',
        data: { thing: 'stuff' } };
      ep.sendEvent(e);
      await ep.flush();

      const output = await getJsonRequest(s);
      expect(output.length).toEqual(1);
      checkCustomEvent(output[0], e, user);
    });
  }));

  it('stringifies user attributes in custom event', eventsServerTest(async s => {
    const config = Object.assign({}, defaultConfig, { inlineUsersInEvents: true });
    await withEventProcessor(config, s, async ep => {
      const e = { kind: 'custom', creationDate: 1000, user: numericUser, key: 'eventkey',
        data: { thing: 'stuff' } };
      ep.sendEvent(e);
      await ep.flush();

      const output = await getJsonRequest(s);
      expect(output.length).toEqual(1);
      checkCustomEvent(output[0], e, stringifiedNumericUser);
    });
  }));

  it('filters user in custom event', eventsServerTest(async s => {
    const config = Object.assign({}, defaultConfig, { allAttributesPrivate: true,
      inlineUsersInEvents: true });
    await withEventProcessor(config, s, async ep => {
      const e = { kind: 'custom', creationDate: 1000, user: user, key: 'eventkey',
        data: { thing: 'stuff' } };
      ep.sendEvent(e);
      await ep.flush();

      const output = await getJsonRequest(s);
      expect(output.length).toEqual(1);
      checkCustomEvent(output[0], e, filteredUser);
    });
  }));

  it('sends nothing if there are no events', eventsServerTest(async s => {
    await withEventProcessor(defaultConfig, s, async ep => {
      await ep.flush();
      expect(s.requestCount()).toEqual(0);
    });
  }));

  it('sends SDK key', eventsServerTest(async s => {
    await withEventProcessor(defaultConfig, s, async ep => {
      const e = { kind: 'identify', creationDate: 1000, user: user };
      ep.sendEvent(e);
      await ep.flush();

      const request = await s.nextRequest();
      expect(request.headers['authorization']).toEqual(sdkKey);
    });
  }));

  function verifyUnrecoverableHttpError(status) {
    return eventsServerTest(async s => {
      s.forMethodAndPath('post', '/bulk', TestHttpHandlers.respond(status));
      await withEventProcessor(defaultConfig, s, async ep => {
        const e = { kind: 'identify', creationDate: 1000, user: user };
        ep.sendEvent(e);
        await expect(ep.flush()).rejects.toThrow('error ' + status);

        expect(s.requestCount()).toEqual(1);
        await s.nextRequest();

        ep.sendEvent(e);
        await expect(ep.flush()).rejects.toThrow(/SDK key is invalid/);
        expect(s.requestCount()).toEqual(1);
      });
    });
  }

  function verifyRecoverableHttpError(status) {
    return eventsServerTest(async s => {
      s.forMethodAndPath('post', '/bulk', TestHttpHandlers.respond(status));
      await withEventProcessor(defaultConfig, s, async ep => {
        var e = { kind: 'identify', creationDate: 1000, user: user };
        ep.sendEvent(e);
        await expect(ep.flush()).rejects.toThrow('error ' + status);

        expect(s.requestCount()).toEqual(2);
        await s.nextRequest();
        await s.nextRequest();

        s.forMethodAndPath('post', '/bulk', TestHttpHandlers.respond(200));
        ep.sendEvent(e);
        await ep.flush();
        expect(s.requestCount()).toEqual(3);
      });
    });
  }

  it('retries after a 400 error', verifyRecoverableHttpError(400));

  it('stops sending events after a 401 error', verifyUnrecoverableHttpError(401));

  it('stops sending events after a 403 error', verifyUnrecoverableHttpError(403));

  it('retries after a 408 error', verifyRecoverableHttpError(408));

  it('retries after a 429 error', verifyRecoverableHttpError(429));

  it('retries after a 503 error', verifyRecoverableHttpError(503));

  it('swallows errors from failed background flush', eventsServerTest(async s => {
    // This test verifies that when a background flush fails, we don't emit an unhandled
    // promise rejection. Jest will fail the test if we do that.

    const config = Object.assign({}, defaultConfig, { flushInterval: 0.25 });
    await withEventProcessor(config, s, async ep => {
      s.forMethodAndPath('post', '/bulk', TestHttpHandlers.respond(500));

      ep.sendEvent({ kind: 'identify', creationDate: 1000, user: user });

      // unfortunately we must wait for both the flush interval and the 1-second retry interval
      await sleepAsync(1500);
      expect(s.requestCount()).toEqual(2);
    });
  }));
});
