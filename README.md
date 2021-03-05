# Based-Loans-Subgraph

[Based Loans](https://based.money/) is an open-source protocol for algorithmic, efficient Money Markets on the Ethereum blockchain. This Subgraph ingests the core contracts of the protocol.

## Networks and Performance

The subgraph can be found on The Graph Hosted Service at https://thegraph.com.

#### Ethereum Mainnet Subgraph

- PlayGround: https://thegraph.com/explorer/subgraph/based-loans/based-loans
- GraphQL Endpoint: https://api.thegraph.com/subgraphs/name/based-loans/based-loans

#### Ethereum Rinkeby Subgraph

- PlayGround: https://thegraph.com/explorer/subgraph/based-loans/rinkeby-based-loans
- GraphQL Endpoint: https://api.thegraph.com/subgraphs/name/based-loans/rinkeby-based-loans

You can also run this subgraph locally, if you wish. Instructions for that can be found in [The Graph Documentation](https://thegraph.com/docs/quick-start).

## ABI

The ABI used is `ctoken.json`. It is a stripped down version of the full abi provided by Based Loans, that satisfies the calls we need to make for both cETH and cERC20 contracts. This way we can use 1 ABI file, and one mapping for cETH and cERC20.

## Getting started with querying

Below are a few ways to show how to query the Based Loans Subgraph for data. The queries show most of the information that is queryable, but there are many other filtering options that can be used, just check out the [querying api](https://github.com/graphprotocol/graph-node/blob/master/docs/graphql-api.md).

You can also see the saved queries on the hosted service for examples.
