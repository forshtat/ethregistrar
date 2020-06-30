// SPDX-License-Identifier:MIT
pragma solidity ^0.5.0;

import "@openzeppelin/contracts/ownership/Ownable.sol";

import "./BaseRelayRecipient.sol";

contract TestProxy is BaseRelayRecipient, Ownable  {

    function versionRecipient() public view returns (string memory) {
        return "2.0.0-alpha.1+opengsn.testproxy.irelayrecipient";
    }

    constructor(address forwarder) public {
        trustedForwarder = forwarder;
    }

    function isOwner() public view returns (bool) {
        return _msgSender() == owner();
    }

    event Test(address _msgSender, address msgSender);
    //not a proxy method; just for testing.
    function test() public {
        emit Test(_msgSender(), msg.sender);
    }

    function execute(address target, bytes calldata func) external onlyOwner {

        //solhint-disable-next-line
        (bool success, bytes memory ret) = target.call(func);
        require(success, string(ret));
    }

//    function _msgSender() internal override(Context, BaseRelayRecipient) view returns (address payable) {
//        return BaseRelayRecipient._msgSender();
//    }
}
