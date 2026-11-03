// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ProofOfCall} from "../src/ProofOfCall.sol";

/// @notice Walks the deployed runtime bytecode and fails on any opcode that could move value,
///         run foreign code in our context, create contracts or self-destruct.
///         External reads compile to STATICCALL (0xFA), which is the only call opcode allowed.
contract BytecodeTest is Test {
    function test_runtime_hasNoValueMovingOrCodeRunningOpcodes() public {
        ProofOfCall poc = new ProofOfCall(address(this), 1 hours, 10, new address[](0));
        bytes memory code = address(poc).code;
        uint256 end = code.length;
        // Strip the CBOR metadata: its length is stored big-endian in the last two bytes.
        uint256 metaLen = (uint256(uint8(code[end - 2])) << 8) | uint256(uint8(code[end - 1]));
        end -= metaLen + 2;

        bool sawStaticcall;
        for (uint256 i = 0; i < end; ++i) {
            uint8 op = uint8(code[i]);
            if (op >= 0x60 && op <= 0x7f) {
                i += op - 0x5f; // skip PUSH1..PUSH32 immediates
                continue;
            }
            assertTrue(op != 0xf0, "CREATE found");
            assertTrue(op != 0xf1, "CALL found");
            assertTrue(op != 0xf2, "CALLCODE found");
            assertTrue(op != 0xf4, "DELEGATECALL found");
            assertTrue(op != 0xf5, "CREATE2 found");
            assertTrue(op != 0xff, "SELFDESTRUCT found");
            assertTrue(op != 0x5f, "PUSH0 found (evm_version must stay paris for QIE)");
            if (op == 0xfa) sawStaticcall = true;
        }
        assertTrue(sawStaticcall, "expected STATICCALL for oracle reads");
    }
}
