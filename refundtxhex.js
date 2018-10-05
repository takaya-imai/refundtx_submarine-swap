var bitcoin = require("bitcoinjs-lib");
var testnet = bitcoin.networks.testnet;
var crypto = require("crypto");
var bip65 = require("bip65");
var util = require('util');
var request = require('sync-request');
var argv = require('argv');

//
// add valuables to execute
//
argv.option({
    name: 'privkeyhex',
    short: 'p',
    type: 'string',
    description: 'private key in hex to unlock outputs of swap address'
});

argv.option({
    name: 'swapaddr',
    short: 's',
    type: 'string',
    description: 'swap address'
});

argv.option({
    name: 'callbackaddr',
    short: 'c',
    type: 'string',
    description: 'address of refund or callback(p2pkh, p2sh)'
});

argv.option({
    name: 'redeemscripthex',
    short: 'r',
    type: 'string',
    description: 'redeemscript in hex'
});

var args = argv.run();
if (Object.keys(args.options).length < 4) {
     console.log("check 'node refundtxhex.js -h'");
     process.exit(1)
};

var bobPrivKeyHex = args.options.privkeyhex;
var swapAddr = args.options.swapaddr;
var refundAddr = args.options.callbackaddr;
var redeemScriptHex = args.options.redeemscripthex;

//
// create refund hex tx
//
const bobKeyPair = bitcoin.ECPair.fromPrivateKey(Buffer.from(bobPrivKeyHex, "hex"), testnet);

var [outpointsToSwapAddr, valueSatoshi] = txOutpointsToSwapAddr(swapAddr);

// todo: add fee estimation
var feeSatoshi = valueSatoshi * 0.01;

const txb = new bitcoin.TransactionBuilder(testnet)
txb.setLockTime(bip65.encode({ utc: utcNow() }));
for (var outpoint of outpointsToSwapAddr) {
    txb.addInput(outpoint.txid, outpoint.index, 0xfffffffe);
};
txb.addOutput(refundAddr, valueSatoshi-feeSatoshi);

const tx = txb.buildIncomplete()
const hashType = bitcoin.Transaction.SIGHASH_ALL;
var redeemScript = Buffer.from(redeemScriptHex, "hex");
for (var idx in  outpointsToSwapAddr) {
    const signatureHash = tx.hashForSignature(parseInt(idx), redeemScript, hashType)
    const redeemScriptSig = bitcoin.payments.p2sh({
      redeem: {
        input: bitcoin.script.compile([
          bitcoin.script.signature.encode(bobKeyPair.sign(signatureHash), hashType),
          bobKeyPair.publicKey,
          bitcoin.script.OP_FALSE,
        ]),
        output: redeemScript
      }
    }).input
    tx.setInputScript(parseInt(idx), redeemScriptSig)
}

console.log(tx.toHex());


//
// tx outputpoint
//
// input: btc address
// output: [outpoints, value]
//           outpoints:
//              {
//                  txid,
//                  index,
//              }
function txOutpointsToSwapAddr(swapAddr){
    var url = util.format("https://testnet.blockchain.info/rawaddr/%s", swapAddr)
    var txs = JSON.parse(httpGet(url)).txs;

    var outpoints = [];
    var totalValue = 0;
    for (var tx of txs) {
        var outputs = tx.out;
        for (var output of outputs) {
            if (!output.addr) { continue; };

            if (output.addr == swapAddr) {
                outpoints.push({txid: tx.hash, index: output.n});
                totalValue += output.value;
            };
        };
    };

    return [outpoints, totalValue];
};

//
// currenct time in utc
//
// input: nothing
// output: currecnt time in utc in seconds
function utcNow() {
    return Math.floor(Date.now() / 1000)
}

//
// http GET
//
// input: url
// output: response body
function httpGet(url){
    var response = request('GET', url);
    if (response.statusCode != 200) {
        throw new Error(util.format("invalid status code: %s", response.statusCode));
    };
    return response.getBody();
}
