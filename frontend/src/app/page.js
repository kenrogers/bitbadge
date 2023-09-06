"use client";

import { useState, useEffect } from "react";
import {
  AppConfig,
  UserSession,
  showConnect,
  openContractCall,
} from "@stacks/connect";
import { StacksTestnet } from "@stacks/network";
import {
  tupleCV,
  uintCV,
  bufferCV,
  principalCV,
  listCV,
} from "@stacks/transactions";
import { hexToBytes } from "@stacks/common";
import { Transaction } from "bitcoinjs-lib";
import { hex, base64 } from "@scure/base";
import * as btc from "@scure/btc-signer";
import { bytesToHex } from "@noble/hashes/utils";
import { getAddress, signTransaction } from "sats-connect";

export default function Home() {
  const [userData, setUserData] = useState({});
  const [blockDetails, setBlockDetails] = useState(
    JSON.parse(localStorage.getItem("blockDetails")) || {}
  );

  const appConfig = new AppConfig();
  const userSession = new UserSession({ appConfig });

  // Effect hook to check and see if the tx has been confirmed using blockstream API
  useEffect(() => {
    const intervalId = setInterval(() => {
      const txid = JSON.parse(localStorage.getItem("txid"));
      if (txid) {
        fetch(`https://blockstream.info/testnet/api/tx/${txid}/status`)
          .then((response) => response.json())
          .then(async (status) => {
            // set txStatus in localStorage if it is confirmed, otherwise we want to leave it pending
            if (status.confirmed) {
              localStorage.setItem("txStatus", "confirmed");
              // set the block details
              const blockDetails = {
                block_height: status.block_height,
                block_hash: status.block_hash,
              };
              setBlockDetails(blockDetails);
              localStorage.setItem(
                "blockDetails",
                JSON.stringify(blockDetails)
              );
              // fetch and set the tx raw
              const rawResponse = await fetch(
                `https://blockstream.info/testnet/api/tx/${txid}/hex`
              );
              const txRaw = await rawResponse.text();
              localStorage.setItem("txRaw", txRaw);
              // fetch and set the merkle proof
              const proofResponse = await fetch(
                `https://blockstream.info/testnet/api/tx/${txid}/merkle-proof`
              );
              const txMerkleProof = await proofResponse.json();
              localStorage.setItem(
                "txMerkleProof",
                JSON.stringify(txMerkleProof)
              );
              clearInterval(intervalId);
            }
          })
          .catch((err) => console.error(err));
      }
    }, 10000);
    return () => clearInterval(intervalId); // Clean up on component unmount
  }, []);

  useEffect(() => {
    if (userSession.isSignInPending()) {
      userSession.handlePendingSignIn().then((userData) => {
        setUserData(userData);
      });
    } else if (userSession.isUserSignedIn()) {
      setUserData(userSession.loadUserData());
    }
  }, []);

  const connectWallet = () => {
    showConnect({
      userSession,
      network: StacksTestnet,
      appDetails: {
        name: "Bitbadges",
        icon: "https://freesvg.org/img/bitcoin.png",
      },
      onFinish: () => {
        window.location.reload();
      },
      onCancel: () => {
        // handle if user closed connection prompt
      },
    });
  };

  const disconnectWallet = () => {
    userSession.signUserOut(window.location.origin);
    setUserData({});
  };

  const setAddress = async (address) => {
    setXverseAddress(address);
  };

  const createPsbtWithOpReturnXverse = async () => {
    // First get the address
    let xverseAddress;
    let xversePubKey;
    const getAddressOptions = {
      payload: {
        purposes: ["payment"],
        message: "Address for receiving payments",
        network: {
          type: "Testnet",
        },
      },
      onFinish: async (response) => {
        console.log(response.addresses[0]);
        xverseAddress = response.addresses[0].address;
        xversePubKey = response.addresses[0].publicKey;
      },
      onCancel: () => alert("Request canceled"),
    };
    await getAddress(getAddressOptions);

    const testnet = {
      bech32: "tb",
      pubKeyHash: 0x6f,
      scriptHash: 0xc4,
      wif: 0xef,
    };

    const p2wpkh = btc.p2wpkh(xversePubKey, testnet);

    const psbt = new btc.Transaction({
      allowUnknowOutput: true,
      network: testnet,
    });

    // Use the blockstream API to get the utxo set of the authenticated address
    const address = xverseAddress;
    const utxoSetResponse = await fetch(
      `https://blockstream.info/testnet/api/address/${address}/utxo`
    );
    const utxoSet = await utxoSetResponse.json();

    // Add each utxo to the psbt as an input
    let inputIndexes = [];
    let totalValue = 0;
    for (let [index, utxo] of utxoSet.entries()) {
      if (utxo.value > 100) {
        psbt.addInput({
          index: index,
          txid: utxo.txid,
          witnessUtxo: {
            amount: BigInt(utxo.value),
            script: p2wpkh.script,
          },
        });
        totalValue = utxo.value;
        inputIndexes.push(index);
        break;
      } else if (totalValue < 100) {
        totalValue += utxo.value;
        psbt.addInput({
          index: index,
          txid: utxo.txid,
          witnessUtxo: {
            amount: BigInt(utxo.value),
            script: p2wpkh.script,
          },
        });
        inputIndexes.push(index);
      }
    }

    // Calculate the change to be sent back to the sender
    const change = totalValue - 100;

    // Subtract transaction fee from the change
    const changeAfterFee = change - 1000;

    if (changeAfterFee > 0) {
      psbt.addOutputAddress(xverseAddress, BigInt(changeAfterFee), testnet);
    }

    // Add 100 sats output to recipient
    psbt.addOutputAddress(
      "tb1qya9wtp4dyq67ldxz2pyuz40esvgd0cgx9s3pjl",
      100n,
      testnet
    );

    const data = new TextEncoder().encode("test");
    psbt.addOutput({
      script: btc.Script.encode([btc.OP.RETURN, data]),
      amount: 0n,
    });

    const psbtFormatted = psbt.toPSBT();

    // Xverse Process
    const base64PSBT = base64.encode(psbtFormatted);

    const signPsbtOptions = {
      payload: {
        network: {
          type: "Testnet",
        },
        message: "Sign Transaction",
        psbtBase64: base64PSBT,
        broadcast: true,
        inputsToSign: [
          {
            address: xverseAddress,
            signingIndexes: inputIndexes,
          },
        ],
      },
      onFinish: (response) => {
        console.log(response.psbtBase64);
        alert(response.psbtBase64);
      },
      onCancel: () => alert("Canceled"),
    };

    await signTransaction(signPsbtOptions);

    // Hiro Wallet Process
    // console.log(bytesToHex(psbtFormatted));

    // const result = await window.btc.request("signPsbt", {
    //   publicKey: userData.profile.btcPublicKey.p2wpkh,
    //   hex: bytesToHex(psbtFormatted),
    //   network: "testnet",
    // });

    // console.log(result);
  };

  const createPsbtWithOpReturnLeather = async () => {
    const testnet = {
      bech32: "tb",
      pubKeyHash: 0x6f,
      scriptHash: 0xc4,
      wif: 0xef,
    };

    const pubKey = userData.profile.btcPublicKey.p2wpkh;

    const p2wpkh = btc.p2wpkh(pubKey, testnet);

    const psbt = new btc.Transaction({
      allowUnknowOutput: true,
      network: testnet,
    });

    // Use the blockstream API to get the utxo set of the authenticated address
    const address = userData.profile.btcAddress.p2wpkh.testnet;
    const utxoSetResponse = await fetch(
      `https://blockstream.info/testnet/api/address/${address}/utxo`
    );
    const utxoSet = await utxoSetResponse.json();

    // Add each utxo to the psbt as an input
    let inputIndexes = [];
    let totalValue = 0;
    for (let [index, utxo] of utxoSet.entries()) {
      if (utxo.value > 100) {
        psbt.addInput({
          index: index,
          txid: utxo.txid,
          witnessUtxo: {
            amount: BigInt(utxo.value),
            script: p2wpkh.script,
          },
        });
        totalValue = utxo.value;
        inputIndexes.push(index);
        break;
      } else if (totalValue < 100) {
        totalValue += utxo.value;
        psbt.addInput({
          index: index,
          txid: utxo.txid,
          witnessUtxo: {
            amount: BigInt(utxo.value),
            script: p2wpkh.script,
          },
        });
        inputIndexes.push(index);
      }
    }

    // Calculate the change to be sent back to the sender
    const change = totalValue - 100;

    // Subtract transaction fee from the change
    const changeAfterFee = change - 1000;

    if (changeAfterFee > 0) {
      psbt.addOutputAddress(
        userData.profile.btcAddress.p2wpkh.testnet,
        BigInt(changeAfterFee),
        testnet
      );
    }

    // Add 100 sats output to recipient
    psbt.addOutputAddress(
      "tb1qya9wtp4dyq67ldxz2pyuz40esvgd0cgx9s3pjl",
      100n,
      testnet
    );

    const data = new TextEncoder().encode("test");
    psbt.addOutput({
      script: btc.Script.encode([btc.OP.RETURN, data]),
      amount: 0n,
    });

    const psbtFormatted = psbt.toPSBT();

    console.log(bytesToHex(psbtFormatted));

    const result = await window.btc.request("signPsbt", {
      publicKey: userData.profile.btcPublicKey.p2wpkh,
      hex: bytesToHex(psbtFormatted),
      network: "testnet",
    });

    console.log(result);
  };

  // This function sends a Bitcoin transaction and stores the raw transaction and merkle proof in localStorage
  const reserveBitbadge = async () => {
    const resp = await window.btc?.request("sendTransfer", {
      address: "tb1qya9wtp4dyq67ldxz2pyuz40esvgd0cgx9s3pjl",
      amount: "100",
      network: "testnet",
    });

    // Storing txid in local storage
    if (typeof window !== "undefined") {
      localStorage.setItem("txid", JSON.stringify(resp.result.txid));
    }

    localStorage.setItem("txStatus", "pending");
  };

  const removeWitnessData = (txHex) => {
    const tx = Transaction.fromHex(txHex);

    // Create a new empty transaction
    const newTx = new Transaction();

    // Copy version from original transaction
    newTx.version = tx.version;

    // Copy inputs from original transaction
    tx.ins.forEach((input) => {
      newTx.addInput(input.hash, input.index);
    });

    // Copy outputs from original transaction
    tx.outs.forEach((output) => {
      newTx.addOutput(output.script, output.value);
    });

    // Copy locktime from original transaction
    newTx.locktime = tx.locktime;

    return newTx.toHex();
  };

  // This function retrieves raw transaction and merkle proof from localStorage and calls the mint Clarity function
  const mintBitbadge = async () => {
    // Retrieving rawTx and merkleProof from local storage
    let txRaw = "";
    let txMerkleProof = "";

    if (typeof window !== "undefined") {
      txRaw = removeWitnessData(localStorage.getItem("txRaw"));
      txMerkleProof = JSON.parse(localStorage.getItem("txMerkleProof"));
    }

    const blockHeight = blockDetails.block_height;

    // Fetch the block hash
    const blockHashResponse = await fetch(
      `https://blockstream.info/testnet/api/block-height/${blockHeight}`
    );
    const blockHash = await blockHashResponse.text();

    // Fetch the block header
    const blockHeaderResponse = await fetch(
      `https://blockstream.info/testnet/api/block/${blockHash}/header`
    );
    const blockHeaderHex = await blockHeaderResponse.text();

    const txIndex = txMerkleProof.pos;
    const hashes = txMerkleProof.merkle.map(
      (hash) => bufferCV(hexToBytes(hash).reverse()) // lib needs reversed hashes
    ); // Convert each hash to BufferCV and reverse it

    const functionArgs = [
      principalCV(userData.profile.stxAddress.testnet),
      uintCV(blockHeight),
      bufferCV(Buffer.from(txRaw, "hex")),
      bufferCV(Buffer.from(blockHeaderHex, "hex")),
      tupleCV({
        "tx-index": uintCV(txIndex),
        hashes: listCV(hashes),
        "tree-depth": uintCV(txMerkleProof.merkle.length),
      }),
    ];

    const contractAddress = "ST3QFME3CANQFQNR86TYVKQYCFT7QX4PRXM1V9W6H"; // Replace with your contract address
    const contractName = "bitbadge-v3"; // Replace with your contract name
    const functionName = "mint"; // Replace with your function name

    const options = {
      contractAddress,
      contractName,
      functionName,
      functionArgs,
      appDetails: {
        name: "BitBadge",
        icon: "https://freesvg.org/img/bitcoin.png",
      },
      onFinish: (data) => {
        console.log(data);
      },
    };

    await openContractCall(options);
  };

  const getButtonState = () => {
    if (localStorage.getItem("txid")) {
      if (localStorage.getItem("txStatus") == "pending") {
        return {
          text: "Transaction Pending",
          onClick: null,
          disabled: true,
          instructions: "Step 2: Wait for your transaction to confirm",
        };
      } else if (localStorage.getItem("txStatus") == "confirmed") {
        return {
          text: "Mint Your Bitbadge",
          onClick: mintBitbadge,
          disabled: false,
          instructions: "Step 3: Mint your Bitbadge",
        };
      }
    }
    return {
      text: "Reserve Your Bitbadge",
      onClick: reserveBitbadge,
      disabled: false,
      instructions: "Step 1: Reserve your Bitbadge by sending 100 sats",
    };
  };

  return (
    <main className="flex flex-col items-center justify-center min-h-screen p-24">
      <h1 className="text-6xl font-bold text-center text-white">Bitbadges</h1>
      {!userData.profile ? (
        <button
          className="px-4 py-2 mt-4 text-lg font-bold text-white bg-indigo-600 rounded hover:bg-indigo-500"
          onClick={connectWallet}
        >
          Connect Your Wallet
        </button>
      ) : (
        <>
          {(() => {
            const buttonState = getButtonState();
            return (
              <>
                <p className="text-xl text-white">{buttonState.instructions}</p>
                <button
                  className="px-4 py-2 mt-4 text-lg font-bold text-white bg-indigo-600 rounded hover:bg-indigo-500"
                  onClick={buttonState.onClick}
                  disabled={buttonState.disabled}
                >
                  {buttonState.text}
                  {buttonState.disabled && <span className="spinner"></span>}
                </button>
              </>
            );
          })()}
          <button
            className="px-4 py-2 mt-4 text-lg font-bold text-indigo-600 bg-white rounded hover:bg-indigo-500"
            onClick={disconnectWallet}
          >
            Disconnect Wallet
          </button>
          <button
            className="px-4 py-2 mt-4 text-lg font-bold text-indigo-600 bg-white rounded hover:bg-indigo-500"
            onClick={createPsbtWithOpReturnLeather}
          >
            Send PSBT
          </button>
        </>
      )}
    </main>
  );
}
