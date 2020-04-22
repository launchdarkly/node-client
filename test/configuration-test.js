var configuration = require('../configuration');

describe('configuration', function() {
  const defaults = configuration.defaults();

  function emptyConfigWithMockLogger() {
    const logger = {
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
    };
    return { logger };
  }

  function expectDefault(name) {
    const configIn = emptyConfigWithMockLogger();
    const config = configuration.validate(configIn);
    expect(config[name]).toBe(defaults[name]);
    expect(configIn.logger.warn).not.toHaveBeenCalled();
  }

  function checkDeprecated(oldName, newName, value) {
    it('allows "' + oldName + '" as a deprecated equivalent to "' + newName + '"', function() {
      var config0 = emptyConfigWithMockLogger();
      config0[oldName] = value;
      var config1 = configuration.validate(config0);
      expect(config1[newName]).toEqual(value);
      expect(config1[oldName]).toBeUndefined();
      expect(config1.logger.warn).toHaveBeenCalledTimes(1);
    });
  }

  checkDeprecated('base_uri', 'baseUri', 'http://test.com');
  checkDeprecated('stream_uri', 'streamUri', 'http://test.com');
  checkDeprecated('events_uri', 'eventsUri', 'http://test.com');
  checkDeprecated('send_events', 'sendEvents', true);
  checkDeprecated('flush_interval', 'flushInterval', 10);
  checkDeprecated('poll_interval', 'pollInterval', 60);
  checkDeprecated('use_ldd', 'useLdd', true);
  checkDeprecated('all_attributes_private', 'allAttributesPrivate', true);
  checkDeprecated('private_attribute_names', 'privateAttributeNames', ['foo']);
  checkDeprecated('proxy_host', 'proxyHost', 'test.com');
  checkDeprecated('proxy_port', 'proxyPort', 8888);
  checkDeprecated('proxy_auth', 'proxyAuth', 'basic');
  checkDeprecated('feature_store', 'featureStore', {});

  function checkBooleanProperty(name) {
    it('enforces boolean type and default for "' + name + '"', () => {
      expectDefault(name);

      const configIn1 = emptyConfigWithMockLogger();
      configIn1[name] = true;
      const config1 = configuration.validate(configIn1);
      expect(config1[name]).toBe(true);
      expect(configIn1.logger.warn).not.toHaveBeenCalled();

      const configIn2 = emptyConfigWithMockLogger();
      configIn2[name] = false;
      const config2 = configuration.validate(configIn2);
      expect(config2[name]).toBe(false);
      expect(configIn2.logger.warn).not.toHaveBeenCalled();

      const configIn3 = emptyConfigWithMockLogger();
      configIn3[name] = 'abc';
      const config3 = configuration.validate(configIn3);
      expect(config3[name]).toBe(true);
      expect(configIn3.logger.warn).toHaveBeenCalledTimes(1);

      const configIn4 = emptyConfigWithMockLogger();
      configIn4[name] = 0;
      const config4 = configuration.validate(configIn4);
      expect(config4[name]).toBe(false);
      expect(configIn4.logger.warn).toHaveBeenCalledTimes(1);
    });
  }

  checkBooleanProperty('stream');
  checkBooleanProperty('sendEvents');
  checkBooleanProperty('offline');
  checkBooleanProperty('useLdd');
  checkBooleanProperty('allAttributesPrivate');
  checkBooleanProperty('diagnosticOptOut');

  function checkNumericProperty(name, validValue) {
    it('enforces numeric type and default for "' + name + '"', () => {
      expectDefault(name);

      const configIn1 = emptyConfigWithMockLogger();
      configIn1[name] = validValue;
      const config1 = configuration.validate(configIn1);
      expect(config1[name]).toBe(validValue);
      expect(configIn1.logger.warn).not.toHaveBeenCalled();

      const configIn2 = emptyConfigWithMockLogger();
      configIn2[name] = 'no';
      const config2 = configuration.validate(configIn2);
      expect(config2[name]).toBe(defaults[name]);
      expect(configIn2.logger.warn).toHaveBeenCalledTimes(1);
    });
  }

  checkNumericProperty('timeout', 10);
  checkNumericProperty('capacity', 500);
  checkNumericProperty('flushInterval', 45);
  checkNumericProperty('pollInterval', 45);
  checkNumericProperty('userKeysCapacity', 500);
  checkNumericProperty('userKeysFlushInterval', 45);
  checkNumericProperty('diagnosticRecordingInterval', 110);

  function checkNumericRange(name, minimum, maximum) {
    if (minimum !== undefined) {
      it('enforces minimum for "' + name + '"', () => {
        const configIn = emptyConfigWithMockLogger();
        configIn[name] = minimum - 1;
        const config = configuration.validate(configIn);
        expect(config[name]).toBe(minimum);
        expect(configIn.logger.warn).toHaveBeenCalledTimes(1);
      });
    }
    if (maximum !== undefined) {
      it('enforces maximum for "' + name + '"', () => {
        const configIn = emptyConfigWithMockLogger();
        configIn[name] = maximum + 1;
        const config = configuration.validate(configIn);
        expect(config[name]).toBe(maximum);
        expect(configIn.logger.warn).toHaveBeenCalledTimes(1);
      });
    }
  }

  checkNumericRange('pollInterval', 30);
  checkNumericRange('diagnosticRecordingInterval', 60);

  function checkUriProperty(name) {
    expectDefault(name);

    const configIn1 = emptyConfigWithMockLogger();
    configIn1[name] = 'http://test.com/';
    const config1 = configuration.validate(configIn1);
    expect(config1[name]).toEqual('http://test.com'); // trailing slash is removed
    expect(configIn1.logger.warn).not.toHaveBeenCalled();

    const configIn2 = emptyConfigWithMockLogger();
    configIn2[name] = 3;
    const config2 = configuration.validate(configIn2);
    expect(config2[name]).toEqual(defaults[name]);
    expect(configIn2.logger.warn).toHaveBeenCalledTimes(1);
  }

  checkUriProperty('baseUri');
  checkUriProperty('streamUri');
  checkUriProperty('eventsUri');

  it('enforces array value for privateAttributeNames', () => {
    const configIn0 = emptyConfigWithMockLogger();
    const config0 = configuration.validate(configIn0);
    expect(config0.privateAttributeNames).toEqual([]);
    expect(configIn0.logger.warn).not.toHaveBeenCalled();

    const configIn1 = emptyConfigWithMockLogger();
    configIn1.privateAttributeNames = [ 'a' ];
    const config1 = configuration.validate(configIn1);
    expect(config1.privateAttributeNames).toEqual([ 'a' ]);
    expect(configIn1.logger.warn).not.toHaveBeenCalled();

    const configIn2 = emptyConfigWithMockLogger();
    configIn2.privateAttributeNames = 'no';
    const config2 = configuration.validate(configIn2);
    expect(config2.privateAttributeNames).toEqual([]);
    expect(configIn2.logger.warn).toHaveBeenCalledTimes(1);
  });

  it('should not share the default featureStore across different config instances', () => {
    var config1 = configuration.validate({});
    var config2 = configuration.validate({});
    expect(config1.featureStore).not.toEqual(config2.featureStore);
  });

  it('complains if you set an unknown property', () => {
    const configIn = emptyConfigWithMockLogger();
    configIn.unsupportedThing = true;
    configuration.validate(configIn);
    expect(configIn.logger.warn).toHaveBeenCalledTimes(1);
  });
});
