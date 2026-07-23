# Data Backup and Restore Internals

ChatHub's user-level backup is a versioned JSON contract with a single
export/import registry. It is designed for account migration and recovery of
core relational state, not full PostgreSQL or object-storage disaster recovery.

## Contract and registry

`DataBackupV2` carries `formatVersion`, `appVersion`, `exportedAt`, source
`mode`, the source database's actual `schemaHash`,
`secretStrategy: deployment-keyed`, and whitelisted table arrays.

The canonical registry in
`packages/database/src/repositories/dataBackupRegistry.ts` controls both
directions:

- supported tables and dependency order
- target-user scoping
- generated, natural, singleton, and junction ID behavior
- immediate and deferred foreign-key mappings
- replace deletion order

Never add a table to only the exporter or importer. A supported table must have
all of its required relational dependencies in the registry. Derived tables
whose source data is excluded, such as `messageChunks` without RAG `chunks`,
must remain excluded.

## Export flow

`GET /webapi/data/export` authenticates with the same request context as tRPC,
opens a read-only repeatable-read transaction, and queries every registry table
for the current user. Rows are deterministically ordered and stripped of
`userId`; the user row is reduced to onboarding and preference state, and
`messages.messageOrder` is omitted because it is a bigint server sequence.

Any query error rejects the whole response. The route returns an attachment
only after every table succeeds, with `Cache-Control: no-store`. The transfer
does not depend on S3.

## Import flow

`POST /webapi/data/import` accepts `strategy=merge|replace` and an expected
conversation version. Processing is ordered as follows:

1. Parse and structurally validate the file.
2. Compare the source migration hash with the target database journal.
3. Authenticate every non-empty encrypted settings/provider vault using the
   current `KEY_VAULTS_SECRET`.
4. Acquire the per-user conversation write lock.
5. Run the selected restore in the lock's existing transaction.
6. Restore deferred cyclic/self relationships after all IDs are mapped.
7. Advance `conversationVersion` and commit.

Importer exceptions are never converted into per-table success. A failed batch
escapes to the transaction owner, which rolls back merge inserts or both the
delete and restore phases of replace.

Generated records use target-user/source-record stable IDs and retain source
IDs as `clientId` where supported. Natural and junction conflicts are checked
only against the target user. This makes merge idempotent without treating
another user's IDs as duplicates. Column metadata filters unknown properties
and converts every timestamp; version normalizers provide required fields
added after older known migrations.

Deferred restoration handles message parents/quotas, thread parents and source
messages, message-group parents, group references, agent targets, and memory
references. Dangling optional parent pointers in legacy backups become `null`;
required missing dependencies fail the transaction.

## Compatibility and security

- Version 2 rejects unknown tables and future formats.
- Unversioned v1 table backups may contain old excluded tables; non-empty
  unsupported tables are reported as ignored.
- Known source migration hashes at or before the target are accepted.
- Newer and unknown hashes are rejected before mutation.
- Vault plaintext is never added to a backup or error response.
- Auth, OAuth, RBAC, API keys, files, binary objects, RAG data, and derived
  caches are outside this contract.

## Verification

High-signal coverage includes:

- database export/import round trip across different users
- group-chat, message-group, thread, parent, and memory ID remapping
- repeat-import row-count idempotency
- replace failure rollback preserving original target data
- actual source schema hash and strict format checks
- deployment-keyed credential preflight
- authenticated direct transfer and conversation-version conflict handling
- service rejection paths that never emit success after a failure

Run database repository tests from `packages/database`; run route, service, and
file-parser tests from the repository root. Follow the targeted-test and
type-check commands in [Testing and Change Checklist](../testing.md).
