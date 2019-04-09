const PISA = artifacts.require("PISA");
const DisputeRegistry = artifacts.require("DisputeRegistry");
const assert = require("chai").assert;
const truffleAssert = require('truffle-assertions');

function getCurrentTime() {
    return new Promise(function(resolve) {
      web3.eth.getBlock("latest").then(function(block) {
            resolve(block.timestamp)
        });
    })
}

function timeout(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

contract('DisputeRegistry', (accounts) => {
  it('Test Days', async () => {
    var registryInstance = await DisputeRegistry.deployed();
    var accounts =  await web3.eth.getAccounts();

    assert.equal(await registryInstance.getWeekday.call(1555236000),0, "1st Sunday");
    assert.equal(await registryInstance.getWeekday.call(1555322400),1, "1st Monday");
    assert.equal(await registryInstance.getWeekday.call(1555408800),2, "1st Tuesday");
    assert.equal(await registryInstance.getWeekday.call(1555495200),3, "1st Wednesday");
    assert.equal(await registryInstance.getWeekday.call(1555581600),4, "1st Thursday");
    assert.equal(await registryInstance.getWeekday.call(1555668000),5, "1st Friday");
    assert.equal(await registryInstance.getWeekday.call(1555754400),6, "1st Saturday");
    assert.equal(await registryInstance.getWeekday.call(1555840800),7, "2nd Sunday");
    assert.equal(await registryInstance.getWeekday.call(1555927200),8, "2nd Monday");
    assert.equal(await registryInstance.getWeekday.call(1556013600),9, "2nd Tuesday");
    assert.equal(await registryInstance.getWeekday.call(1556100000),10, "2nd Wednesday");
    assert.equal(await registryInstance.getWeekday.call(1556186400),11, "2nd Thursday");
    assert.equal(await registryInstance.getWeekday.call(1556272800),12, "2nd Friday");
    assert.equal(await registryInstance.getWeekday.call(1556359200),13, "2nd Saturday");
    assert.equal(await registryInstance.getWeekday.call(1556445600),0, "Full loop");

  });


});