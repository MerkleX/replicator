# merkleX Replicator

This is very early code and should only be used by those knowing what they're doing.

To learn more: [https://discord.gg/YWzv8aZ](https://discord.gg/YWzv8aZ)


## How to Run

Currently the replicator only support sourcing liquidity from Coinbase Pro and placing said liquidity on merkleX.

First things first, you'll need to configure settings.js with your secret keys to connect to both merkleX and Coinbase Pro.

```
cp settings.example.js settings.js
vim settings.js
```

For merkleX we suggest updating your user on the DCN to have different keys for trading, withdrawing and management. This will ensure that if your trading key (the key provided to this library) is compromised, your funds will still be secure. That can be done [here](https://etherscan.io/address/0x84f6451efe944ba67bedb8e0cf996fa1feb4031d#writeContract) using `user_propose_recovery_address`, `user_set_recovery_address`, and `user_set_withdraw_address`. If you just want to give the replicator a try, simply create a new MetaMask account with limited funds and export your private key for this library.

Once settings.js has all the appropriate keys, you can edit `bot.js` to configure which markets to replicate by editing the `sources` array. To run the replicator, simply run:

```
node bot.js
```

If you see lots of TRADING\_LIMIT errors, turn off the replicator and place resting orders with the max and min prices you feel comfortable trading with. merkleX will prompt you update your trading limits. Once the trading limits are set, run the replicator using the above command.

## Features

 - [x] replicate liquidity from source to target
 - [x] replay trades on liquidity source
 - [x] configurable replication
 - [ ] merkleX automatic limit adjustment
 - [ ] share available funds on liquidity target
 - [ ] hybrid liquidity sources (combine orderbooks)
 - [ ] mulitple liquidity sources for single market
 - [ ] post trade verification
 - [ ] risk profiling

## Supported Trading Platforms

| Platform | Source Liquidity | Provide Liquidity |
| --- | --- | --- |
| merkleX | false | true |
| Coinbase Pro | true | false |

