const Boom = require('boom')
const pluralize = require('pluralize')

const { TRANSACTION_TYPES } = require('@arkecosystem/crypto').constants
const { TransactionGuard } = require('@arkecosystem/core-transaction-pool')

const container = require('@arkecosystem/core-container')

const blockchain = container.resolvePlugin('blockchain')
const config = container.resolvePlugin('config')
const logger = container.resolvePlugin('logger')
const transactionPool = container.resolvePlugin('transactionPool')

const utils = require('../utils')
const schema = require('../schema/transactions')
const { transactions: repository } = require('../../../repositories')

/**
 * @type {Object}
 */
exports.index = {
  /**
   * @param  {Hapi.Request} request
   * @param  {Hapi.Toolkit} h
   * @return {Hapi.Response}
   */
  async handler(request, h) {
    const transactions = await repository.findAll({
      ...request.query,
      ...utils.paginate(request),
    })

    return utils.toPagination(request, transactions, 'transaction')
  },
  options: {
    validate: schema.index,
  },
}

/**
 * @type {Object}
 */
exports.store = {
  /**
   * @param  {Hapi.Request} request
   * @param  {Hapi.Toolkit} h
   * @return {Hapi.Response}
   */
  async handler(request, h) {
    if (!transactionPool.options.enabled) {
      return Boom.serverUnavailable('Transaction pool is disabled.')
    }

    const { eligible, notEligible } = transactionPool.checkEligibility(
      request.payload.transactions,
    )

    const guard = new TransactionGuard(transactionPool)

    for (const ne of notEligible) {
      guard.invalidate(ne.transaction, ne.reason)
    }

    await guard.validate(eligible)

    if (guard.hasAny('accept')) {
      logger.info(
        `Received ${guard.accept.length} new ${pluralize(
          'transaction',
          guard.accept.length,
        )}`,
      )

      await guard.addToTransactionPool('accept')
    }

    if (guard.hasAny('broadcast')) {
      container.resolvePlugin('p2p').broadcastTransactions(guard.broadcast)
    }

    return guard.toJson()
  },
  options: {
    validate: schema.store,
    plugins: {
      pagination: {
        enabled: false,
      },
    },
  },
}

/**
 * @type {Object}
 */
exports.show = {
  /**
   * @param  {Hapi.Request} request
   * @param  {Hapi.Toolkit} h
   * @return {Hapi.Response}
   */
  async handler(request, h) {
    const transaction = await repository.findById(request.params.id)

    if (!transaction) {
      return Boom.notFound('Transaction not found')
    }

    return utils.respondWithResource(request, transaction, 'transaction')
  },
  options: {
    validate: schema.show,
  },
}

/**
 * @type {Object}
 */
exports.unconfirmed = {
  /**
   * @param  {Hapi.Request} request
   * @param  {Hapi.Toolkit} h
   * @return {Hapi.Response}
   */
  async handler(request, h) {
    if (!transactionPool.options.enabled) {
      return Boom.serverUnavailable('Transaction pool is disabled.')
    }

    const pagination = utils.paginate(request)

    let transactions = transactionPool.getTransactions(
      pagination.offset,
      pagination.limit,
    )
    transactions = transactions.map(transaction => ({
      serialized: transaction,
    }))

    return utils.toPagination(
      request,
      {
        count: transactionPool.getPoolSize(),
        rows: transactions,
      },
      'transaction',
    )
  },
  options: {
    validate: schema.unconfirmed,
  },
}

/**
 * @type {Object}
 */
exports.showUnconfirmed = {
  /**
   * @param  {Hapi.Request} request
   * @param  {Hapi.Toolkit} h
   * @return {Hapi.Response}
   */
  handler(request, h) {
    if (!transactionPool.options.enabled) {
      return Boom.serverUnavailable('Transaction pool is disabled.')
    }

    let transaction = transactionPool.getTransaction(request.params.id)

    if (!transaction) {
      return Boom.notFound('Transaction not found')
    }

    transaction = { serialized: transaction.serialized }

    return utils.respondWithResource(request, transaction, 'transaction')
  },
  options: {
    validate: schema.showUnconfirmed,
  },
}

/**
 * @type {Object}
 */
exports.search = {
  /**
   * @param  {Hapi.Request} request
   * @param  {Hapi.Toolkit} h
   * @return {Hapi.Response}
   */
  async handler(request, h) {
    const transactions = await repository.search({
      ...request.query,
      ...request.payload,
      ...utils.paginate(request),
    })

    return utils.toPagination(request, transactions, 'transaction')
  },
  options: {
    validate: schema.search,
  },
}

/**
 * @type {Object}
 */
exports.types = {
  /**
   * @param  {Hapi.Request} request
   * @param  {Hapi.Toolkit} h
   * @return {Hapi.Response}
   */
  async handler(request, h) {
    return {
      data: TRANSACTION_TYPES,
    }
  },
}

/**
 * @type {Object}
 */
exports.fees = {
  /**
   * @param  {Hapi.Request} request
   * @param  {Hapi.Toolkit} h
   * @return {Hapi.Response}
   */
  async handler(request, h) {
    return {
      data: config.getConstants(blockchain.getLastBlock().data.height).fees,
    }
  },
}
