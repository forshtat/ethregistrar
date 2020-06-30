const { ether, expectEvent } = require('@openzeppelin/test-helpers')
const ProxyRelayProvider = require('@opengsn/paymasters/dist/src/ProxyRelayProvider').default
const ENS = artifacts.require('@ensdomains/ens/ENSRegistry');
const PublicResolver = artifacts.require('@ensdomains/resolver/PublicResolver');
const BaseRegistrar = artifacts.require('./BaseRegistrarImplementation');
const ETHRegistrarController = artifacts.require('./ETHRegistrarController');
const DummyOracle = artifacts.require('./DummyOracle');
const StablePriceOracle = artifacts.require('./StablePriceOracle');

/* GSN */
const IRelayHub = artifacts.require('IRelayHub')
const TestToken = artifacts.require('TestToken')
const TestUniswap = artifacts.require('TestUniswap')

const proxyFactoryOutput = require('./gsnabi/ProxyFactory.json')
const proxyDeployingPaymasterOutput = require('./gsnabi/ProxyDeployingPaymaster.json')

const Contract = require('web3-eth-contract')
const GsnTestEnvironment = require('@opengsn/gsn/dist/GsnTestEnvironment').default
/* GSN */

const { evm } = require("@ensdomains/test-utils");

const namehash = require('eth-ens-namehash');
const sha3 = require('web3-utils').sha3;
const toBN = require('web3-utils').toBN;

const DAYS = 24 * 60 * 60;

contract.only('TestEthRegistrarControllerWithGSNProxyProvider', function (accounts) {
    let ens;
    let resolver;
    let baseRegistrar;
    let controller;
    let priceOracle;

    const secret = "0x0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF";
    const ownerAccount = accounts[0]; // Account that owns the registrar
    const registrantAccount = accounts[1]; // Account that owns test names

    let gasless
    let proxyAddress
    let proxyFactoryContract

    before(async () => {
        gasless = await web3.eth.personal.newAccount('password')
        await web3.eth.personal.unlockAccount(gasless, 'password')
        ens = await ENS.new();

        resolver = await PublicResolver.new(ens.address);

        baseRegistrar = await BaseRegistrar.new(ens.address, namehash.hash('eth'), {from: ownerAccount});
        await ens.setSubnodeOwner('0x0', sha3('eth'), baseRegistrar.address);

        const dummyOracle = await DummyOracle.new(toBN(100000000));
        priceOracle = await StablePriceOracle.new(dummyOracle.address, [1]);
        controller = await ETHRegistrarController.new(
            baseRegistrar.address,
            priceOracle.address,
            600,
            86400,
            {from: ownerAccount});
        await baseRegistrar.addController(controller.address, {from: ownerAccount});
        await controller.setPriceOracle(priceOracle.address, {from: ownerAccount});

        // GSN + ProxyFactory + TokenPaymaster setup
        proxyFactoryContract = new Contract(proxyFactoryOutput.abi)
        proxyFactoryContract.setProvider(web3.currentProvider)
        const gas = 1e7
        const proxyFactory = await proxyFactoryContract.deploy({
            data: proxyFactoryOutput.bytecode
        }).send({
            from: accounts[0],
            gas
        })
        const uniswap = await TestUniswap.new(2, 1, {
            value: (5e18).toString(),
            gas
        })
        const token = await TestToken.at(await uniswap.tokenAddress())

        const paymasterContract = new Contract(proxyDeployingPaymasterOutput.abi)
        paymasterContract.setProvider(web3.currentProvider)
        const paymaster = await paymasterContract.deploy({
            data: proxyDeployingPaymasterOutput.bytecode,
            arguments: [[uniswap.address], proxyFactory._address]
        }).send({
            from: accounts[0],
            gas
        })
      paymaster.setProvider(web3.currentProvider)
        const {
            deploymentResult: {
                relayHubAddress,
                stakeManagerAddress,
                forwarderAddress
            }
        } = await GsnTestEnvironment.startGsn('localhost', false)
        const hub = await IRelayHub.at(relayHubAddress)
        await paymaster.methods.setRelayHub(hub.address).send({
          from: accounts[0]
        })
        await paymaster.methods.setTrustedForwarder(forwarderAddress).send({
          from: accounts[0]
        })
        await hub.depositFor(paymaster._address, {
            value: 1e18.toString()
        })
        const gsnConfig = {
            relayHubAddress,
            forwarderAddress,
            stakeManagerAddress,
            paymasterAddress: paymaster._address,
            verbose: true
        }
        const proxyRelayProvider = new ProxyRelayProvider(
          proxyFactory._address,
          web3.currentProvider,
          gsnConfig, {
              asyncPaymasterData: async () => {
                  // @ts-ignore
                  return web3.eth.abi.encodeParameters(['address'], [uniswap.address])
              }
          }
        )

        proxyAddress = await proxyRelayProvider.calculateProxyAddress(gasless)

        await token.mint(1e20.toString())
        await token.transfer(proxyAddress, 1e18.toString())

        ETHRegistrarController.web3.setProvider(proxyRelayProvider)
    });

    it('should permit new registrations', async () => {
        var commitment = await controller.makeCommitment("newname", registrantAccount, secret);
        var tx = await controller.commit(commitment, {
            from: gasless
        });
        assert.equal(await controller.commitments(commitment), (await web3.eth.getBlock(tx.receipt.blockNumber)).timestamp);

        await expectEvent.inTransaction(tx.tx, proxyFactoryContract, 'ProxyDeployed', { proxyAddress })

        await evm.advanceTime((await controller.minCommitmentAge()).toNumber());
        var balanceBefore = await web3.eth.getBalance(controller.address);
        var tx = await controller.register('newname', registrantAccount, 28 * DAYS, secret, {
          value: 28 * DAYS + 1,
          gasPrice: 0,
          from: gasless
        })
        assert.equal(tx.logs.length, 1);
        assert.equal(tx.logs[0].event, "NameRegistered");
        assert.equal(tx.logs[0].args.name, "newname");
        assert.equal(tx.logs[0].args.owner, registrantAccount);
        assert.equal((await web3.eth.getBalance(controller.address)) - balanceBefore, 28 * DAYS);
    });
});
