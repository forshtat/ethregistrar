// SPDX-License-Identifier:MIT
pragma solidity ^0.5.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestToken is ERC20 {

    function mint(uint amount) public {
        _mint(msg.sender, amount);
    }
}
