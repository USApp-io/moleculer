/*
 * moleculer
 * Copyright (c) 2019 MoleculerJS (https://github.com/moleculerjs/moleculer)
 * MIT Licensed
 */

"use strict";

const { defaultsDeep } = require("lodash");
const { parseByteString } = require("../../utils");
const zlib = require("zlib");
const Promise = require("bluebird");

/**
 * This is a transmission compression middleware. It supports
 * the `deflate`, `deflateRaw` & `gzip` compression methods.
 *
 * @param {String} method
 */
module.exports = function CompressionMiddleware(opts) {
	opts = defaultsDeep(opts, { method: "deflate", threshold: "1kb" });

	let compress, decompress;
	const threshold = parseByteString(opts.threshold);

	switch(opts.method) {
		case "deflate":
			compress = Promise.promisify(zlib.deflate);
			decompress = Promise.promisify(zlib.inflate);
			break;
		case "deflateRaw":
			compress = Promise.promisify(zlib.deflateRaw);
			decompress = Promise.promisify(zlib.inflateRaw);
			break;
		case "gzip":
			compress = Promise.promisify(zlib.gzip);
			decompress = Promise.promisify(zlib.gunzip);
			break;
		default:
			/* istanbul ignore next */
			throw new Error("Unknow compression method: " + opts.method);
	}

	let logger;

	return {
		name: "Compression",

		created(broker) {
			logger = broker.getLogger("TX-COMPRESS");
			/* istanbul ignore next */
			logger.info(`The transmission is COMPRESSED by '${opts.method}'. Threshold: ${ threshold != null ? opts.threshold : "none"}`);
		},

		transporterSend(next) {
			return (topic, data, meta) => {
				if (threshold != null && data.length < threshold) {
					logger.debug(`Packet '${topic}' is small and not compressed. Size: ${data.length}`);
					return next(topic, Buffer.concat([Buffer.from([0x00]), data]), meta);
				}
				return compress(data)
					.then(res => {
						logger.debug(`Packet '${topic}' compressed. Saving: ${Number((1 - (res.length / data.length)) * 100).toFixed(0)}%`, data.length, res.length);
						return next(topic, Buffer.concat([Buffer.from([0x01]), res]), meta);
					});
			};
		},

		transporterReceive(next) {
			return (cmd, data, s) => {
				const isCompressed = data.readInt8(0);
				if (isCompressed == 0) {
					logger.debug(`Packet '${cmd}' is small and not compressed. Size: ${data.length}`);
					return next(cmd, data.slice(1), s);
				} else {
					return decompress(data.slice(1))
						.then(res => {
							logger.debug(`Packet '${cmd}' decompressed. Saving: ${Number((1 - (data.length / res.length)) * 100).toFixed(0)}%`, res.length, data.length);
							return next(cmd, res, s);
						});
				}
			};
		}
	};
};