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

4. **Database Support**
   - `transaction()` wrapper for database transactions
   - Automatic rollback on error

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

## Next Steps (Phase 2)

1. Migrate existing services to extend BaseService
2. Implement service registry in serviceBootstrap.ts
3. Add dependency injection
4. Add service metrics and monitoring