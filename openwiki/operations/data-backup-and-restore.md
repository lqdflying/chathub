# Data Backup and Restore Internals

ChatHub's user-level backup is a versioned JSON contract with a single
export/import registry. It is designed for account migration and recovery of
core relational state, not full PostgreSQL or object-storage disaster recovery.

## Contract and registry

`DataBackupV2` carries `formatVersion`, `appVersion`, `exportedAt`, source
`mode`, the source database's actual `schemaHash`,
`secretStrategy: deployment-keyed`, and whitelisted table arrays.

New exports always write `mode: postgres`. The importer still recognizes
`mode: pglite` in old version 2 files and unversioned version 1 table exports.
That compatibility is input-only; it does not enable a browser database at
runtime.

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

## Startup repair for chat-group membership ownership

The chat-group membership migration repairs legacy `chat_groups_agents` rows
before installing composite ownership constraints:

1. If the referenced group and agent have the same owner but the junction
   `userId` is stale, normalize the junction owner using null-safe comparison.
2. Delete every remaining membership without a matching user, group owner, or
   agent owner. This covers missing parents as well as cross-account links.
3. Create the composite `(id, userId)` parent indexes.
4. Inspect all five membership foreign keys through PostgreSQL catalogs and
   replace missing, unvalidated, or semantically incorrect definitions.
5. Validate every constraint with `ON DELETE CASCADE` and `ON UPDATE NO ACTION`.

Docker startup runs the same logic through
`ensureChatGroupMembershipOwnership.cjs` after Drizzle migrations. The helper
is transactional and idempotent, checks that all three tables exist, and is safe
to rerun after a restored database or migration-journal drift. The normal server
migration command runs the same convergence after Drizzle as well, including
databases that already recorded an earlier variant of the migration. Cascading
foreign keys ensure deleting a user, group, or agent cannot leave a membership
or block parent deletion because of a stale junction row. Back up PostgreSQL
before upgrading; an orphaned or true cross-owner link cannot be assigned safely
and is deliberately removed rather than guessed.

## Compatibility and security

- Version 2 rejects unknown tables and future formats.
- Version 2 files from the retired PGlite edition remain importable when their
  schema hash is known.
- Unversioned v1 table backups from the older IndexedDB/Dexie edition may
  contain old excluded tables; non-empty unsupported tables are reported as
  ignored.
- Known source migration hashes at or before the target are accepted.
- Newer and unknown hashes are rejected before mutation.
- Vault plaintext is never added to a backup or error response.
- Auth, OAuth, RBAC, API keys, files, binary objects, RAG data, and derived
  caches are outside this contract.

## Moving from a retired local edition

There is no direct connection from a server deployment to data stored inside a
user's old browser profile. Before removing or clearing the old edition, create
its JSON export and retain the file. Deploy the current PostgreSQL edition,
sign in as the destination account, then import that file from **Settings ->
Storage**.

Do not copy IndexedDB or PGlite files into the container and do not expect an
automatic startup migration. If the original browser data remains but no JSON
export was created, recovery must be performed with the old application version
that can still read that browser profile; the current server cannot inspect it.

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
