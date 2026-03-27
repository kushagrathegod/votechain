// scripts/deploy.js
// Run: npx hardhat run scripts/deploy.js --network localhost
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying Voting contract with account:", deployer.address);
    console.log("Account balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");

    // Deploy the Voting contract
    const Voting = await ethers.getContractFactory("Voting");
    const voting = await Voting.deploy();
    await voting.waitForDeployment();

    const contractAddress = await voting.getAddress();
    console.log("✅  Voting contract deployed at:", contractAddress);

    // Save contract address and ABI for use by the frontend and backend
    const artifact = require("../artifacts/contracts/Voting.sol/Voting.json");

    const deployInfo = {
        address: contractAddress,
        abi: artifact.abi,
        network: (await ethers.provider.getNetwork()).name,
        deployedAt: new Date().toISOString(),
        deployer: deployer.address,
    };

    // Write to a file the frontend & server can read
    const outPath = path.join(__dirname, "../frontend/src/contract.json");
    fs.writeFileSync(outPath, JSON.stringify(deployInfo, null, 2));
    console.log(`📄  Contract info written to ${outPath}`);

    // Also write to root for easy access
    fs.writeFileSync(
        path.join(__dirname, "../contract.json"),
        JSON.stringify(deployInfo, null, 2)
    );

    console.log("\n Setup complete! Start the server with:  npm run frontend");
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
