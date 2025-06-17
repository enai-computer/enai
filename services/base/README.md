# Service Architecture - Phase 1

This directory contains the base infrastructure for the standardized service architecture.

## Files

- `BaseService.ts` - Abstract base class for all services
- `ServiceError.ts` - Custom error types for services
- `index.ts` - Export aggregator

## BaseService Features

The `BaseService` class provides:

1. **Lifecycle Management**
   - `initialize()` - Async initialization during bootstrap
   - `cleanup()` - Resource cleanup during shutdown
   - `healthCheck()` - Service health monitoring

2. **Logging**
   - Built-in logger with service name context
   - Helper methods: `logInfo()`, `logDebug()`, `logWarn()`, `logError()`

3. **Error Handling**
   - `execute()` wrapper for async operations with automatic logging
   - Tracks operation duration and logs errors with context

## Error Types

- `ServiceError` - Base error class with code, statusCode, and details
- `NotFoundError` - Resource not found (404)
- `ValidationError` - Input validation failures (400)
- `AuthorizationError` - Authorization failures (403)
- `ExternalServiceError` - External service failures (503)
- `DatabaseError` - Database operation failures (500)
- `RateLimitError` - Rate limit exceeded (429)
- `TimeoutError` - Operation timeout (504)
- `ConflictError` - Resource conflicts (409)

## Usage Example

```typescript
import { BaseService, NotFoundError } from '../base';
import { BaseServiceDependencies } from '../interfaces';

interface MyServiceDeps extends BaseServiceDependencies {
  // Additional dependencies
}

export class MyService extends BaseService<MyServiceDeps> {
  constructor(deps: MyServiceDeps) {
    super('MyService', deps);
  }

  async initialize(): Promise<void> {
    await super.initialize();
    // Custom initialization
  }

  async getItem(id: string): Promise<Item> {
    return this.execute('getItem', async () => {
      const item = await this.deps.db.prepare(
        'SELECT * FROM items WHERE id = ?'
      ).get(id);
      
      if (!item) {
        throw new NotFoundError('Item', id);
      }
      
      return item;
    }, { id });
  }
}
```

## Migration Status

All services have been successfully migrated to extend BaseService. The standardized service architecture is now fully implemented with:

1. ✅ All services extending BaseService
2. ✅ Service registry implemented in serviceBootstrap.ts
3. ✅ Full dependency injection pattern
4. ✅ Lifecycle management (initialize, cleanup, healthCheck)
5. ✅ Consistent error handling with custom error types
6. ✅ Built-in logging with service context

The service architecture provides a solid foundation for future enhancements such as metrics collection and monitoring.