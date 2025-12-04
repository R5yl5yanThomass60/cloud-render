// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract PrivateCloudRenderFHE is SepoliaConfig {
    struct EncryptedTask {
        uint256 id;
        euint32 encryptedFileHash;
        euint32 encryptedSceneParams;
        euint32 encryptedDeadline;
        uint256 timestamp;
    }

    struct DecryptedTask {
        string fileHash;
        string sceneParams;
        uint256 deadline;
        bool isRevealed;
    }

    uint256 public taskCount;
    mapping(uint256 => EncryptedTask) public encryptedTasks;
    mapping(uint256 => DecryptedTask) public decryptedTasks;

    mapping(string => euint32) private encryptedNodeContribution;
    string[] private nodeList;

    mapping(uint256 => uint256) private requestToTaskId;

    event TaskSubmitted(uint256 indexed id, uint256 timestamp);
    event DecryptionRequested(uint256 indexed id);
    event TaskDecrypted(uint256 indexed id);

    modifier onlySubmitter(uint256 taskId) {
        _;
    }

    /// @notice Submit a new encrypted rendering task
    function submitEncryptedTask(
        euint32 encryptedFileHash,
        euint32 encryptedSceneParams,
        euint32 encryptedDeadline
    ) public {
        taskCount += 1;
        uint256 newId = taskCount;

        encryptedTasks[newId] = EncryptedTask({
            id: newId,
            encryptedFileHash: encryptedFileHash,
            encryptedSceneParams: encryptedSceneParams,
            encryptedDeadline: encryptedDeadline,
            timestamp: block.timestamp
        });

        decryptedTasks[newId] = DecryptedTask({
            fileHash: "",
            sceneParams: "",
            deadline: 0,
            isRevealed: false
        });

        emit TaskSubmitted(newId, block.timestamp);
    }

    /// @notice Request decryption of a rendering task
    function requestTaskDecryption(uint256 taskId) public onlySubmitter(taskId) {
        EncryptedTask storage task = encryptedTasks[taskId];
        require(!decryptedTasks[taskId].isRevealed, "Already decrypted");

        bytes32 ;
        ciphertexts[0] = FHE.toBytes32(task.encryptedFileHash);
        ciphertexts[1] = FHE.toBytes32(task.encryptedSceneParams);
        ciphertexts[2] = FHE.toBytes32(task.encryptedDeadline);

        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptTask.selector);
        requestToTaskId[reqId] = taskId;

        emit DecryptionRequested(taskId);
    }

    /// @notice Callback for decrypted task data
    function decryptTask(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 taskId = requestToTaskId[requestId];
        require(taskId != 0, "Invalid request");

        EncryptedTask storage eTask = encryptedTasks[taskId];
        DecryptedTask storage dTask = decryptedTasks[taskId];
        require(!dTask.isRevealed, "Already decrypted");

        FHE.checkSignatures(requestId, cleartexts, proof);

        string[] memory results = abi.decode(cleartexts, (string[]));

        dTask.fileHash = results[0];
        dTask.sceneParams = results[1];
        dTask.deadline = stringToUint(results[2]);
        dTask.isRevealed = true;

        if (FHE.isInitialized(encryptedNodeContribution[results[0]]) == false) {
            encryptedNodeContribution[results[0]] = FHE.asEuint32(0);
            nodeList.push(results[0]);
        }
        encryptedNodeContribution[results[0]] = FHE.add(
            encryptedNodeContribution[results[0]],
            FHE.asEuint32(1)
        );

        emit TaskDecrypted(taskId);
    }

    /// @notice Get decrypted task details
    function getDecryptedTask(uint256 taskId) public view returns (
        string memory fileHash,
        string memory sceneParams,
        uint256 deadline,
        bool isRevealed
    ) {
        DecryptedTask storage t = decryptedTasks[taskId];
        return (t.fileHash, t.sceneParams, t.deadline, t.isRevealed);
    }

    /// @notice Get encrypted node contribution
    function getEncryptedNodeContribution(string memory node) public view returns (euint32) {
        return encryptedNodeContribution[node];
    }

    /// @notice Request node contribution decryption
    function requestNodeContributionDecryption(string memory node) public {
        euint32 count = encryptedNodeContribution[node];
        require(FHE.isInitialized(count), "Node not found");

        bytes32 ;
        ciphertexts[0] = FHE.toBytes32(count);

        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptNodeContribution.selector);
        requestToTaskId[reqId] = bytes32ToUint(keccak256(abi.encodePacked(node)));
    }

    /// @notice Callback for decrypted node contribution
    function decryptNodeContribution(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 nodeHash = requestToTaskId[requestId];
        string memory node = getNodeFromHash(nodeHash);

        FHE.checkSignatures(requestId, cleartexts, proof);

        uint32 count = abi.decode(cleartexts, (uint32));
    }

    // Helper functions
    function bytes32ToUint(bytes32 b) private pure returns (uint256) {
        return uint256(b);
    }

    function getNodeFromHash(uint256 hash) private view returns (string memory) {
        for (uint i = 0; i < nodeList.length; i++) {
            if (bytes32ToUint(keccak256(abi.encodePacked(nodeList[i]))) == hash) {
                return nodeList[i];
            }
        }
        revert("Node not found");
    }

    function stringToUint(string memory s) private pure returns (uint256) {
        bytes memory b = bytes(s);
        uint256 result = 0;
        for (uint i = 0; i < b.length; i++) {
            require(b[i] >= 0x30 && b[i] <= 0x39, "Invalid character");
            result = result * 10 + (uint8(b[i]) - 48);
        }
        return result;
    }
}
