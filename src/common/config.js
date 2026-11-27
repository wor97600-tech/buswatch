const config = {
  cityName: '海口',
  cityId: '129',
  legacyCityId: '129',
  chelaile: {
    enabled: true,
    host: 'ts-api.tundrey.com',
    timeout: 8000,
    retry: 1,
    slowTimeout: 9000,
    slowRetry: 0,
    searchTimeout: 5000,
    searchRetry: 0,
    cityTimeout: 8000,
    cityRetry: 0
  },
  net: {
    allowHttps: false,
    preferHttps: false,
    timeout: 8000,
    hedgeDelay: 3000,
    retryDelay: 400
  },
  cache: {
    search: 5 * 60 * 1000,
    stop: 60 * 60 * 1000,
    line: 24 * 60 * 60 * 1000,
    live: 45 * 1000
  }
}

export default config
