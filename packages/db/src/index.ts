import {
  Collection,
  Db,
  Filter,
  FindOptions,
  InsertOneOptions,
  UpdateFilter,
  UpdateOptions,
  DeleteOptions,
  Document,
  AnyBulkWriteOperation,
  BulkWriteOptions,
} from 'mongodb';

export interface TenantContext {
  schoolId: string;
}

/**
 * TenantRepo enforces strict multi-tenant isolation at the data access layer.
 * All operations automatically inject and enforce the schoolId filter.
 */
export class TenantRepo<T extends { schoolId: string }> {
  constructor(
    private readonly collection: Collection<T>,
    private readonly ctx: TenantContext
  ) {
    if (!ctx?.schoolId) {
      throw new Error('TenantRepo initialization failed: schoolId context is required');
    }
  }

  get rawCollection(): Collection<T> {
    return this.collection;
  }

  private withTenantFilter(filter: Filter<T>): Filter<T> {
    return {
      ...filter,
      schoolId: this.ctx.schoolId,
    } as Filter<T>;
  }

  find(filter: Filter<T> = {}, options?: FindOptions<T>) {
    return this.collection.find(this.withTenantFilter(filter), options);
  }

  async findOne(filter: Filter<T>, options?: FindOptions<T>): Promise<T | null> {
    return (await this.collection.findOne(this.withTenantFilter(filter), options)) as T | null;
  }

  async insertOne(doc: Omit<T, '_id' | 'schoolId'>, options?: InsertOneOptions) {
    const docWithTenant = {
      ...doc,
      schoolId: this.ctx.schoolId,
    } as unknown as any;
    return this.collection.insertOne(docWithTenant, options);
  }

  async updateOne(
    filter: Filter<T>,
    update: UpdateFilter<T> | Partial<T>,
    options?: UpdateOptions
  ) {
    return this.collection.updateOne(this.withTenantFilter(filter), update, options);
  }

  async updateMany(
    filter: Filter<T>,
    update: UpdateFilter<T>,
    options?: UpdateOptions
  ) {
    return this.collection.updateMany(this.withTenantFilter(filter), update, options);
  }

  async deleteOne(filter: Filter<T>, options?: DeleteOptions) {
    return this.collection.deleteOne(this.withTenantFilter(filter), options);
  }

  async deleteMany(filter: Filter<T>, options?: DeleteOptions) {
    return this.collection.deleteMany(this.withTenantFilter(filter), options);
  }

  async countDocuments(filter: Filter<T> = {}): Promise<number> {
    return this.collection.countDocuments(this.withTenantFilter(filter));
  }

  async bulkWrite(
    operations: AnyBulkWriteOperation<T>[],
    options?: BulkWriteOptions
  ) {
    // Injects tenant filter to all operation filters
    const tenantOperations = operations.map((op) => {
      if ('updateOne' in op) {
        return {
          updateOne: {
            ...op.updateOne,
            filter: this.withTenantFilter(op.updateOne.filter as Filter<T>),
          },
        };
      }
      if ('updateMany' in op) {
        return {
          updateMany: {
            ...op.updateMany,
            filter: this.withTenantFilter(op.updateMany.filter as Filter<T>),
          },
        };
      }
      if ('deleteOne' in op) {
        return {
          deleteOne: {
            ...op.deleteOne,
            filter: this.withTenantFilter(op.deleteOne.filter as Filter<T>),
          },
        };
      }
      if ('deleteMany' in op) {
        return {
          deleteMany: {
            ...op.deleteMany,
            filter: this.withTenantFilter(op.deleteMany.filter as Filter<T>),
          },
        };
      }
      if ('replaceOne' in op) {
        return {
          replaceOne: {
            ...op.replaceOne,
            filter: this.withTenantFilter(op.replaceOne.filter as Filter<T>),
          },
        };
      }
      if ('insertOne' in op) {
        return {
          insertOne: {
            document: {
              ...(op.insertOne.document as any),
              schoolId: this.ctx.schoolId,
            },
          },
        };
      }
      return op;
    });

    return this.collection.bulkWrite(tenantOperations as any, options);
  }

  aggregate<R extends Document = Document>(pipeline: Document[] = []) {
    // Enforce $match schoolId as the very first stage of aggregation pipeline
    const tenantMatch = { $match: { schoolId: this.ctx.schoolId } };
    return this.collection.aggregate<R>([tenantMatch, ...pipeline]);
  }
}

