/* eslint-disable prefer-const */ // to satisfy AS compiler

// For each division by 10, add one to exponent to truncate one significant figure
import { Address, BigDecimal, BigInt, log } from '@graphprotocol/graph-ts'
import { Market, Comptroller } from '../types/schema'
// PriceOracle is valid from Comptroller deployment until block 8498421
import { PriceOracle } from '../types/templates/CToken/PriceOracle'
// PriceOracle2 is valid from 8498422 until present block (until another proxy upgrade)
import { PriceOracle2 } from '../types/templates/CToken/PriceOracle2'
import { ERC20 } from '../types/templates/CToken/ERC20'
import { CToken } from '../types/templates/CToken/CToken'

import {
  exponentToBigDecimal,
  mantissaFactor,
  mantissaFactorBD,
  cTokenDecimalsBD,
  zeroBD,
} from './helpers'

let cUSDCAddress = '0x49368caf1091842f1f313ed8dd6fb3c491c6720f'
let cETHAddress = '0xd878726082ab9d06e863157058fb3bee50d1c41a'
let daiAddress = '0x89d24a6b4ccb1b6faa2625fe562bdd9a23260359'

// Used for all cERC20 contracts
function getTokenPrice(
  blockNumber: i32,
  eventAddress: Address,
  underlyingAddress: Address,
  underlyingDecimals: i32,
): BigDecimal {
  let comptroller = Comptroller.load('1')
  let oracleAddress = comptroller.priceOracle as Address
  let underlyingPrice = zeroBD

  /* This must use the cToken address.
   *
   * This returns the value without factoring in token decimals and wei, so we must divide
   * the number by (ethDecimals - tokenDecimals) and again by the mantissa.
   * USDC would be 10 ^ ((18 - 6) + 18) = 10 ^ 30
   *
   * NOTE: PriceOracle V1 combining based on block number is removed, as BasedLoans protocol
   * started with PriceOracle V2 from its deployment.
   * To see the original code, refer compound-v2-subgraph here:
   * https://github.com/graphprotocol/compound-v2-subgraph/blob/master/src/mappings/markets.ts#L52
   */
  let mantissaDecimalFactor = 18 - underlyingDecimals + 18
  let bdFactor = exponentToBigDecimal(mantissaDecimalFactor)
  let oracle = PriceOracle2.bind(oracleAddress)

  let underlyingPriceView = oracle.try_getUnderlyingPriceView(eventAddress)
  if (!underlyingPriceView.reverted) {
    underlyingPrice = underlyingPriceView.value.toBigDecimal().div(bdFactor)
  } else {
    // log.info(
    //   'Contract getTokenPrice call reverted! call_name: {}, ctoken_address: {}, blockNumber: {}',
    //   ['try_getUnderlyingPriceView', eventAddress.toHexString(), blockNumber.toString()],
    // )
  }

  return underlyingPrice
}

export function createMarket(marketAddress: string): Market {
  let market: Market
  let contract = CToken.bind(Address.fromString(marketAddress))

  // It is CETH, which has a slightly different interface
  if (marketAddress == cETHAddress) {
    market = new Market(marketAddress)
    market.underlyingAddress = Address.fromString(
      '0x0000000000000000000000000000000000000000',
    )
    market.underlyingDecimals = 18
    market.underlyingPrice = BigDecimal.fromString('1')
    market.underlyingName = 'Ether'
    market.underlyingSymbol = 'ETH'
    market.underlyingPriceUSD = zeroBD
    // It is all other CERC20 contracts
  } else {
    market = new Market(marketAddress)
    market.underlyingAddress = contract.underlying()
    let underlyingContract = ERC20.bind(market.underlyingAddress as Address)
    market.underlyingDecimals = underlyingContract.decimals()
    if (market.underlyingAddress.toHexString() != daiAddress) {
      market.underlyingName = underlyingContract.name()
      market.underlyingSymbol = underlyingContract.symbol()
    } else {
      market.underlyingName = 'Dai Stablecoin v1.0 (DAI)'
      market.underlyingSymbol = 'DAI'
    }
    market.underlyingPriceUSD = zeroBD
    market.underlyingPrice = zeroBD
    if (marketAddress == cUSDCAddress) {
      market.underlyingPriceUSD = BigDecimal.fromString('1')
    }
  }

  let interestRateModelAddress = contract.try_interestRateModel()
  let reserveFactor = contract.try_reserveFactorMantissa()

  market.borrowRate = zeroBD
  market.cash = zeroBD
  market.collateralFactor = zeroBD
  market.exchangeRate = zeroBD
  market.interestRateModelAddress = interestRateModelAddress.reverted
    ? Address.fromString('0x0000000000000000000000000000000000000000')
    : interestRateModelAddress.value
  market.name = contract.name()
  market.reserves = zeroBD
  market.supplyRate = zeroBD
  market.symbol = contract.symbol()
  market.totalBorrows = zeroBD
  market.totalSupply = zeroBD

  market.accrualBlockNumber = 0
  market.blockTimestamp = 0
  market.borrowIndex = zeroBD
  market.reserveFactor = reserveFactor.reverted ? BigInt.fromI32(0) : reserveFactor.value

  return market
}

// Get eth price in USD from price oracle.
function getETHinUSD(blockNumber: i32): BigDecimal {
  let comptroller = Comptroller.load('1')
  let oracleAddress = comptroller.priceOracle as Address
  let oracle = PriceOracle2.bind(oracleAddress)
  let ethPriceInUSD = zeroBD

  let underlyingPriceView = oracle.try_getUnderlyingPriceView(
    Address.fromString(cETHAddress),
  )
  if (!underlyingPriceView.reverted) {
    ethPriceInUSD = underlyingPriceView.value.toBigDecimal().div(mantissaFactorBD)
  } else {
    // log.info(
    //   'Contract getETHinUSD call reverted! call_name: {}, ctoken_address: {}, blockNumber: {}',
    //   ['try_getUnderlyingPriceView', cETHAddress, blockNumber.toString()],
    // )
  }

  return ethPriceInUSD
}

export function updateMarket(
  marketAddress: Address,
  blockNumber: i32,
  blockTimestamp: i32,
): Market {
  let marketID = marketAddress.toHexString()
  let market = Market.load(marketID)
  if (market == null) {
    market = createMarket(marketID)
  }
  // Only updateMarket if it has not been updated this block
  if (market.accrualBlockNumber != blockNumber) {
    let contractAddress = Address.fromString(market.id)
    let contract = CToken.bind(contractAddress)

    // Price is calculated based on USD instead of ETH
    let ethPriceInUSD = getETHinUSD(blockNumber)

    // if (ethPriceInUSD != zeroBD) {
    // Only update when eth price is obtained correctly
    if (market.id == cETHAddress) {
      // if cETH, we only update USD price
      market.underlyingPriceUSD = ethPriceInUSD //.truncate(market.underlyingDecimals)
    } else {
      let tokenPriceUSD = getTokenPrice(
        blockNumber,
        contractAddress,
        market.underlyingAddress as Address,
        market.underlyingDecimals,
      )
      // if (tokenPriceUSD != zeroBD) {
      // Only update when token price is obtained correctly
      market.underlyingPrice = tokenPriceUSD.div(ethPriceInUSD)
      // .truncate(market.underlyingDecimals)
      // if USDC, we only update ETH price
      if (market.id != cUSDCAddress) {
        market.underlyingPriceUSD = tokenPriceUSD //.truncate(market.underlyingDecimals)
      }
      // }
    }
    // }

    market.accrualBlockNumber = contract.accrualBlockNumber().toI32()
    market.blockTimestamp = blockTimestamp
    let totalSupply = contract.try_totalSupply()
    if (!totalSupply.reverted) {
      market.totalSupply = totalSupply.value.toBigDecimal().div(cTokenDecimalsBD)
    } else {
      // log.info('Contract call reverted! call_name: {}, market_name: {}', [
      //   'try_totalSupply',
      //   market.name,
      // ])
    }

    /* Exchange rate explanation
       In Practice
        - If you call the cDAI contract on bscscan it comes back (2.0 * 10^26)
        - If you call the cUSDC contract on bscscan it comes back (2.0 * 10^14)
        - The real value is ~0.02. So cDAI is off by 10^28, and cUSDC 10^16
       How to calculate for tokens with different decimals
        - Must div by tokenDecimals, 10^market.underlyingDecimals
        - Must multiply by ctokenDecimals, 10^8
        - Must div by mantissa, 10^18
     */
    let exchangeRateStored = contract.try_exchangeRateStored()
    if (!exchangeRateStored.reverted) {
      market.exchangeRate = exchangeRateStored.value
        .toBigDecimal()
        .div(exponentToBigDecimal(market.underlyingDecimals))
        .times(cTokenDecimalsBD)
        .div(mantissaFactorBD)
        .truncate(mantissaFactor)
    } else {
      // log.info('Contract call reverted! call_name: {}, market_name: {}', [
      //   'try_exchangeRateStored',
      //   market.name,
      // ])
    }
    let borrowIndex = contract.try_borrowIndex()
    if (!borrowIndex.reverted) {
      market.borrowIndex = borrowIndex.value
        .toBigDecimal()
        .div(mantissaFactorBD)
        .truncate(mantissaFactor)
    } else {
      // log.info('Contract call reverted! call_name: {}, market_name: {}', [
      //   'try_borrowIndex',
      //   market.name,
      // ])
    }
    let totalReserves = contract.try_totalReserves()
    if (!totalReserves.reverted) {
      market.reserves = totalReserves.value
        .toBigDecimal()
        .div(exponentToBigDecimal(market.underlyingDecimals))
        .truncate(market.underlyingDecimals)
    } else {
      // log.info('Contract call reverted! call_name: {}, market_name: {}', [
      //   'try_totalReserves',
      //   market.name,
      // ])
    }
    let totalBorrows = contract.try_totalBorrows()
    if (!totalBorrows.reverted) {
      market.totalBorrows = totalBorrows.value
        .toBigDecimal()
        .div(exponentToBigDecimal(market.underlyingDecimals))
        .truncate(market.underlyingDecimals)
    } else {
      // log.info('Contract call reverted! call_name: {}, market_name: {}', [
      //   'try_totalBorrows',
      //   market.name,
      // ])
    }
    let getCash = contract.try_getCash()
    if (!getCash.reverted) {
      market.cash = getCash.value
        .toBigDecimal()
        .div(exponentToBigDecimal(market.underlyingDecimals))
        .truncate(market.underlyingDecimals)
    } else {
      // log.info('Contract call reverted! call_name: {}, market_name: {}', [
      //   'try_getCash',
      //   market.name,
      // ])
    }
    let borrowRatePerBlock = contract.try_borrowRatePerBlock()
    if (!borrowRatePerBlock.reverted) {
      market.borrowRate = borrowRatePerBlock.value
        .toBigDecimal()
        .div(mantissaFactorBD)
        .truncate(mantissaFactor)
    } else {
      // log.info('Contract call reverted! call_name: {}, market_name: {}', [
      //   'try_borrowRatePerBlock',
      //   market.name,
      // ])
    }
    let supplyRatePerBlock = contract.try_supplyRatePerBlock()
    if (!supplyRatePerBlock.reverted) {
      market.supplyRate = supplyRatePerBlock.value
        .toBigDecimal()
        .div(mantissaFactorBD)
        .truncate(mantissaFactor)
    } else {
      // log.info('Contract call reverted! call_name: {}, market_name: {}', [
      //   'try_supplyRatePerBlock',
      //   market.name,
      // ])
    }
    market.save()
  }
  return market as Market
}
