<p align="center"><img src="https://assets.wingriders.com/wingriders_logo.png" /></p>

# CAB Backend
[![Docker Pulls](https://img.shields.io/docker/pulls/wingriders/cab-backend?style=for-the-badge&logo=docker&logoColor=ffffff&color=05bf75)](https://hub.docker.com/r/wingriders/cab-backend)

Custom backend for CAB, written in TypeScript using PostgreSQL for data storage. Core highlights:

- ⚖️ Lightweight and efficient: Syncs essential data, including block slots and hashes, tx hashes of submitted transactions, used addresses, and unspent transaction outputs (UTxOs).
- ♻️ Leverages Ogmios for additional data: Uses [Ogmios Ledger State Queries](https://ogmios.dev/mini-protocols/local-state-query/), for protocol parameters, reward account summaries, and other required information.
- 🛠️ Optimized UTxO management: Indexes all transaction outputs while periodically pruning spent transaction outputs to maintain performance and minimize storage requirements.

## Why another indexer / backend service?
We evaluated several alternatives but found none that fit our specific needs for integrating CAB with our backend.
Our focus is on supporting off-chain agents for smart contracts and enabling users to connect directly to our dApp using hardware wallets like Ledger and Trezor.
Here’s how other solutions compared:

- [cardano-db-sync](https://github.com/IntersectMBO/cardano-db-sync): A comprehensive solution for storing all blockchain data in a database. While powerful, it is resource-heavy, consumes significant storage, and is costly to operate, making it overkill for our use case.
- [kupo](https://github.com/CardanoSolutions/kupo): A lightweight indexer with great performance but lacking features for address discovery, which we needed.

To address these gaps, we built a custom backend tailored to our needs. It combines a simple UTxO indexer with periodic pruning of spent transaction outputs. Key features include:

**Address discovery and transaction tracking:** The indexer aggregates used addresses and tx hashes of submitted transactions.

**Ogmios integration:** For cases where direct state queries suffice, our backend wraps essential Ogmios queries.

**Lightweight and efficient:** By keeping only unspent transaction outputs and periodically removing spent ones, we avoid the storage and resource bloat of full indexers while maintaining high performance.

## Deployment
We provide Docker images for CAB Backend. There are individual tags for releases and the `latest` tag on Docker Hub mirrors the state of the `main` branch.

To run CAB Backend requires:
- cardano-node
- ogmios
- PostgreSQL

Example deployment is described in [`docker-compose.yml`](./docker-compose.yml).

### Modes
The CAB Backend can be run in three modes:
- `aggregator` - runs only the chain sync component of the backend, indexing/aggregating the relevant on-chain data to database, and minimal healthstatus API
- `server` - runs the API server that runs queries against data in database
- `both` - runs both modes simultaneously

In our experience separating services these way proved useful, as it enables easier horizontal scaling of the server, which can be beneficial under higher loads. Bear in mind, that if the bottle-neck are the Ogmios queries, Ogmios and cardano-node might also need to be horizontally scaled.


## API
### Get protocol parameters
#### Request
`GET /protocolParameters`

#### Response
**Code:** 200

**Content Example**
```json
{
    "minFeeCoefficient": 44,
    "minFeeConstant": {
        "ada": {
            "lovelace": 155381
        }
    },
    "maxBlockBodySize": {
        "bytes": 90112
    },
    ...
    "collateralPercentage": 150,
    "maxCollateralInputs": 3,
    "version": {
        "major": 8,
        "minor": 0
    }
}
```
Return protocol parameters obtained from Ogmios, the returned type corresponds to `ProtocolParameters` from [`@cardano-ogmios/schema`](https://github.com/CardanoSolutions/ogmios/tree/master/clients/TypeScript/packages/schema)

### Get UTxOs for addresses or references
#### Request
`GET /utxos?addresses=addr...,addr...` or `GET /utxos?references=txHash#index,txHash#index`

**Query:**
- `addresses` - Array of addresses in BECH32 form or in hexadecimal format, separated by commas `,`
- `references` - Array of utxo utxos references in format `{txHash}#{index}`, separated by commas `,`

#### Response
**Code:** 200

**Content Example**
```json
[
    {
        "address": "addr_test1qqydes3g449j3qr68hxhmr4ku7zp7cw88wk0hyl9t395hn8hs9qws4yyv92erd7zlnay2rh7va42gc7rxsm22hpn38zsayyufn",
        "index": 7,
        "transaction": {
            "id": "f61564211310e30c9aa7fc6bd12a86dc5fe94b0f907b0f9a38e6622f8d7c1e26"
        },
        "value": {
            "67e5f959b6e3700559f1c448d63bed7c365d2d3f6536fd21708aaf51": {
                "54": 47999
            },
            "882fcbd24592a24362ea55aea0c292afe75e80fd67928f7266f63229": {
                "43": 80
            },
            "a1e642ef52eb824bf0d527bf0ab6c326256263baab3c8d59c9c2829a": {
                "58": 99700
            },
            "ada": {
                "lovelace": 3385074
            },
            "ec05a96b48af6a59d9b84856e066f837120e4687ef55d3cfa7af845e": {
                "41": 99700
            }
        }
    }
]
```
Array of UTxOs as defined in [`@cardano-ogmios/schema`](https://github.com/CardanoSolutions/ogmios/tree/master/clients/TypeScript/packages/schema).

### Get ledger tip
#### Request
`GET /ledgerTip`

### Response
**Code:** 200

**Content Example**
```json
{
    "slot": 57091262,
    "id": "896db99c3843a1d8f55adcdb9818cecfe6d19d13cd724b5ebd1c5765b2521388"
}
```

### Get reward account summary for stake key hash
#### Request
`GET /rewardAccountSummary/{stakeKeyHash}`

- `{stakeKeyHash}` - is the 28 byte staking credential as hexadecimal string

#### Success Response
**Code:** 200

**Content Example**
```json
{
    "delegate": {
        "id": "pool13m26ky08vz205232k20u8ft5nrg8u68klhn0xfsk9m4gsqsc44v"
    },
    "rewards": {
        "ada": {
            "lovelace": 131492083142
        }
    },
    "deposit": {
        "ada": {
            "lovelace": 2000000
        }
    }
}
```

#### Error Response
**Code:** 404

**Content Example**
```json
{
    "msg": "Stake key not found, or the stake key is not registered"
}
```

### Get list of used addresses for stake key hash
#### Request
`GET /addresses/{stakeKeyHash}`

- `{stakeKeyHash}` - is the 28 byte staking credential as hexadecimal string

#### Response
**Code:** 200

**Content Example**
```json
[
  "004a6518c2871c9c05a06bd6995d6e03ebd973a03d9509324abc9138347a507e54fcae6f3b497ddf679e29d170dad54905e19bbcfb7d398756"
]
```
List of addresses in hexadecimal form


### Filter used addresses
#### Request
`POST /filterUsedAddresses`

Body is JSON with fields:
- `addresses` - list of strings; bech32 addresses

#### Response
**Code:** 200

**Content Example**

```json
[
  {
    "address": "004a6518c2871c9c05a06bd6995d6e03ebd973a03d9509324abc9138347a507e54fcae6f3b497ddf679e29d170dad54905e19bbcfb7d398756",
    "firstSlot": 66570472
  }
]
```
List of used addresses in hexadecimal form

### Get transaction by tx hash
#### Request
`GET /transaction/{txHash}`

- `{txHash}` - is the 32 byte transaction hash as hexadecimal string

#### Success Response
**Code:** `200`

**Content Eample**
```json
{
    "txHash": "0eaf8ec56a53b49579549833c6c761945ad5af8f3597a45a46b967c3074f930a",
    "slot": 56630505,
    "block": {
        "height": 2114733,
        "hash": "f9b02bc5bfbc48d55a8850f8f34a692bc122d3de9f0f64bbbdd1b88f5918efe5"
    }
}
```

#### Error Response
**Code:** `404`

**Content Example**
```
{
    "msg": "Transaction not found"
}
```

### Healthcheck
#### Request
`GET /healthcheck`

#### Response
**Code:** `200`

**Content Eample**
```json
{
    "healthy": true,
    "healthyThresholdSlot": 10,
    "networkSlot": 56636031,
    "ledgerSlot": 56636031,
    "lastBlockSlot": 56636031,
    "uptime": 144.16159705
}
```
- `networkSlot` - slot of the last block that the node it aware of.
- `ledgerSlot` - slot of the last block that has been processed by the ledger
- `lastBlockSlot` - slot of the last block that has been synced to the database


## Configuring
Configuring is done with env vars.
```
# Mode of operation - aggregator | server | both, default is both
MODE=both

# Port of the API server
PORT=3000

# One of "silent" | "fatal" | "error" | "warn" | "info" | "debug" | "trace"
LOG_LEVEL=info

OGMIOS_HOST=localhost
OGMIOS_PORT=1337

# Defines the connection to PostgreSQL, DB_USER, DB_PASSWORD, DB_NAME have no
# default values and must be set
DB_HOST=localhost
DB_PORT=5432
DB_USER=
DB_PASSWORD=
DB_NAME=
DB_SCHEMA=cab_backend
```


## DB Schema
Migrations are autorun on start of the aggregator mode. The current schema is shown here:

```mermaid
classDiagram
direction BT
class address {
   integer first_slot
   bytea address
}
class block {
   bytea hash
   integer slot
   integer height
}
class transaction {
   integer slot
   bytea tx_hash
}

class transaction_output {
    varchar utxo_id
    jsonb ogmios_utxo
    integer slot
    integer spend_slot
    varchar address
}

address  -->  block : first_slot - slot
transaction  -->  block : slot
transaction_output --> block : slot
transaction_output --> block : spend_slot - slot
```
<details>
<summary>See complete definition</summary>

```sql
create table if not exists block (
    slot integer not null primary key,
    hash bytea   not null
);

create table if not exists transaction
(
    tx_hash bytea   not null primary key,
    slot    integer not null
        constraint transaction_slot_block_slot_fk
            references block 
            on delete cascade
);

create index if not exists slot_idx on transaction (slot);

create table if not exists address
(
    address    bytea   not null primary key,
    first_slot integer not null
        constraint address_first_slot_block_slot_fk
            references block
            on delete cascade
);

create index if not exists payment_credential_idx on address (substr(address, 2, 28));

create index if not exists staking_credential_idx on address (substr(address, 30, 28));

create index if not exists first_slot_idx on .address (first_slot);

```
</details>


## Development
The project was created with [bun](https://github.com/CardanoSolutions/kupo). To install dependencies:

```bash
bun install
```

To start the backend with auto-reloading run:

```bash
bun dev
```

### Linting
Linting is done with [biome](https://biomejs.dev/):

```bash
# To lint the code, also checks types with tsc
bun lint

# To fix auto-fixable issues from linting
bun fix
```

### Fixup process

In case some blocks are missing, there is a fixup process to fill missing blocks.

First, detect which blocks are missing:
```sql
SELECT all_heights.height
FROM generate_series(
             (SELECT MIN(height) FROM block),
             (SELECT MAX(height) FROM block)
     ) AS all_heights(height)
         LEFT JOIN block AS b ON b.height = all_heights.height
WHERE b.height IS NULL
ORDER BY all_heights.height;
```

Then, set the env var `FIXUP_MISSING_BLOCKS=` with comma-separated heights of the missing blocks and restart cab-backend.

When there are no more gaps, restart cab-backend with unset `FIXUP_MISSING_BLOCKS`.

<p align="center">
<a href="https://www.wingriders.com/">WingRiders</a> ·
<a href="https://community.wingriders.com/">Community Portal</a> ·
<a href="https://twitter.com/wingriderscom">Twitter</a> ·
<a href="https://discord.gg/t7CdyhK8JA">Discord</a> ·
<a href="https://medium.com/@wingriderscom">Medium</a>
</p>
