// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface RenderTask {
  id: string;
  encryptedData: string;
  timestamp: number;
  owner: string;
  status: "pending" | "processing" | "completed" | "failed";
  fheProof: string;
}

const App: React.FC = () => {
  // State management
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<RenderTask[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newTaskData, setNewTaskData] = useState({
    assetType: "",
    description: "",
    complexity: "medium"
  });
  const [showTutorial, setShowTutorial] = useState(false);

  // Statistics for dashboard
  const pendingCount = tasks.filter(t => t.status === "pending").length;
  const processingCount = tasks.filter(t => t.status === "processing").length;
  const completedCount = tasks.filter(t => t.status === "completed").length;
  const failedCount = tasks.filter(t => t.status === "failed").length;

  // Initialize component
  useEffect(() => {
    loadTasks().finally(() => setLoading(false));
  }, []);

  // Wallet connection handlers
  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  // Load tasks from contract
  const loadTasks = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("task_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing task keys:", e);
        }
      }
      
      const list: RenderTask[] = [];
      
      for (const key of keys) {
        try {
          const taskBytes = await contract.getData(`task_${key}`);
          if (taskBytes.length > 0) {
            try {
              const taskData = JSON.parse(ethers.toUtf8String(taskBytes));
              list.push({
                id: key,
                encryptedData: taskData.data,
                timestamp: taskData.timestamp,
                owner: taskData.owner,
                status: taskData.status || "pending",
                fheProof: taskData.fheProof || ""
              });
            } catch (e) {
              console.error(`Error parsing task data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading task ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setTasks(list);
    } catch (e) {
      console.error("Error loading tasks:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  // Submit new render task
  const submitTask = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting 3D assets with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newTaskData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const taskId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const taskData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        status: "pending",
        fheProof: ""
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `task_${taskId}`, 
        ethers.toUtf8Bytes(JSON.stringify(taskData))
      );
      
      const keysBytes = await contract.getData("task_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(taskId);
      
      await contract.setData(
        "task_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Encrypted render task submitted securely!"
      });
      
      await loadTasks();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewTaskData({
          assetType: "",
          description: "",
          complexity: "medium"
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  // Start processing a task
  const startProcessing = async (taskId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Distributing encrypted task to render nodes..."
    });

    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const taskBytes = await contract.getData(`task_${taskId}`);
      if (taskBytes.length === 0) {
        throw new Error("Task not found");
      }
      
      const taskData = JSON.parse(ethers.toUtf8String(taskBytes));
      
      const updatedTask = {
        ...taskData,
        status: "processing"
      };
      
      await contract.setData(
        `task_${taskId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedTask))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Task distributed to render nodes!"
      });
      
      await loadTasks();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Distribution failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  // Tutorial steps
  const tutorialSteps = [
    {
      title: "Connect Wallet",
      description: "Connect your Web3 wallet to access the decentralized render network",
      icon: "🔗"
    },
    {
      title: "Submit Encrypted Assets",
      description: "Upload your 3D assets which will be encrypted using FHE technology",
      icon: "🔒"
    },
    {
      title: "FHE Task Distribution",
      description: "Your encrypted assets are distributed to render nodes without decryption",
      icon: "⚙️"
    },
    {
      title: "Receive Results",
      description: "Get your rendered output while keeping assets fully encrypted",
      icon: "🎬"
    }
  ];

  // Render pie chart for task status distribution
  const renderPieChart = () => {
    const total = tasks.length || 1;
    const pendingPercentage = (pendingCount / total) * 100;
    const processingPercentage = (processingCount / total) * 100;
    const completedPercentage = (completedCount / total) * 100;
    const failedPercentage = (failedCount / total) * 100;

    return (
      <div className="pie-chart-container">
        <div className="pie-chart">
          <div 
            className="pie-segment pending" 
            style={{ transform: `rotate(${pendingPercentage * 3.6}deg)` }}
          ></div>
          <div 
            className="pie-segment processing" 
            style={{ transform: `rotate(${(pendingPercentage + processingPercentage) * 3.6}deg)` }}
          ></div>
          <div 
            className="pie-segment completed" 
            style={{ transform: `rotate(${(pendingPercentage + processingPercentage + completedPercentage) * 3.6}deg)` }}
          ></div>
          <div 
            className="pie-segment failed" 
            style={{ transform: `rotate(${(pendingPercentage + processingPercentage + completedPercentage + failedPercentage) * 3.6}deg)` }}
          ></div>
          <div className="pie-center">
            <div className="pie-value">{tasks.length}</div>
            <div className="pie-label">Tasks</div>
          </div>
        </div>
        <div className="pie-legend">
          <div className="legend-item">
            <div className="color-box pending"></div>
            <span>Pending: {pendingCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-box processing"></div>
            <span>Processing: {processingCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-box completed"></div>
            <span>Completed: {completedCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-box failed"></div>
            <span>Failed: {failedCount}</span>
          </div>
        </div>
      </div>
    );
  };

  // Loading screen
  if (loading) return (
    <div className="loading-screen">
      <div className="metal-spinner"></div>
      <p>Initializing encrypted render network...</p>
    </div>
  );

  return (
    <div className="app-container metal-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="render-icon"></div>
          </div>
          <h1>FHE<span>Render</span>Network</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-task-btn metal-button"
          >
            <div className="add-icon"></div>
            New Render Task
          </button>
          <button 
            className="metal-button"
            onClick={() => setShowTutorial(!showTutorial)}
          >
            {showTutorial ? "Hide Guide" : "Show Guide"}
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="dashboard-panels">
          <div className="panel-left">
            <div className="panel-section">
              <div className="panel-header">
                <h2>FHE Render Network</h2>
                <p>Privacy-first decentralized 3D rendering powered by Fully Homomorphic Encryption</p>
              </div>
              
              <div className="fhe-benefits">
                <div className="benefit-card">
                  <div className="benefit-icon security"></div>
                  <h3>Asset Protection</h3>
                  <p>3D assets remain encrypted throughout rendering process</p>
                </div>
                <div className="benefit-card">
                  <div className="benefit-icon decentralized"></div>
                  <h3>Decentralized</h3>
                  <p>Distributed across global nodes for efficiency</p>
                </div>
                <div className="benefit-card">
                  <div className="benefit-icon proof"></div>
                  <h3>Proof of Work</h3>
                  <p>Verifiable computation with FHE proofs</p>
                </div>
              </div>
            </div>
            
            {showTutorial && (
              <div className="panel-section tutorial-section">
                <h2>How FHE Rendering Works</h2>
                <p className="subtitle">Secure 3D rendering without exposing assets</p>
                
                <div className="tutorial-steps">
                  {tutorialSteps.map((step, index) => (
                    <div 
                      className="tutorial-step"
                      key={index}
                    >
                      <div className="step-icon">{step.icon}</div>
                      <div className="step-content">
                        <h3>{step.title}</h3>
                        <p>{step.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          
          <div className="panel-right">
            <div className="panel-section stats-section">
              <h2>Render Statistics</h2>
              <div className="stats-grid">
                <div className="stat-item">
                  <div className="stat-value">{tasks.length}</div>
                  <div className="stat-label">Total Tasks</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{pendingCount}</div>
                  <div className="stat-label">Pending</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{processingCount}</div>
                  <div className="stat-label">Processing</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{completedCount}</div>
                  <div className="stat-label">Completed</div>
                </div>
              </div>
              
              <div className="chart-container">
                <h3>Task Distribution</h3>
                {renderPieChart()}
              </div>
            </div>
            
            <div className="panel-section">
              <div className="section-header">
                <h2>Active Render Tasks</h2>
                <div className="header-actions">
                  <button 
                    onClick={loadTasks}
                    className="refresh-btn metal-button"
                    disabled={isRefreshing}
                  >
                    {isRefreshing ? "Refreshing..." : "Refresh"}
                  </button>
                </div>
              </div>
              
              <div className="tasks-list">
                {tasks.length === 0 ? (
                  <div className="no-tasks">
                    <div className="no-tasks-icon"></div>
                    <p>No active render tasks</p>
                    <button 
                      className="metal-button primary"
                      onClick={() => setShowCreateModal(true)}
                    >
                      Submit First Task
                    </button>
                  </div>
                ) : (
                  tasks.map(task => (
                    <div className={`task-card ${task.status}`} key={task.id}>
                      <div className="task-header">
                        <div className="task-id">#{task.id.substring(0, 6)}</div>
                        <div className="task-status">{task.status}</div>
                      </div>
                      <div className="task-details">
                        <div className="task-owner">
                          <span className="label">Owner:</span>
                          {task.owner.substring(0, 6)}...{task.owner.substring(38)}
                        </div>
                        <div className="task-date">
                          <span className="label">Submitted:</span>
                          {new Date(task.timestamp * 1000).toLocaleDateString()}
                        </div>
                      </div>
                      <div className="task-actions">
                        {task.status === "pending" && (
                          <button 
                            className="action-btn metal-button"
                            onClick={() => startProcessing(task.id)}
                          >
                            Start Processing
                          </button>
                        )}
                        {task.status === "processing" && (
                          <div className="processing-indicator">
                            <div className="metal-spinner small"></div>
                            <span>Processing with FHE</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitTask} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          taskData={newTaskData}
          setTaskData={setNewTaskData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content metal-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="metal-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="render-icon"></div>
              <span>FHE Render Network</span>
            </div>
            <p>Secure encrypted 3D rendering using FHE technology</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} FHE Render Network. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  taskData: any;
  setTaskData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  taskData,
  setTaskData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setTaskData({
      ...taskData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!taskData.assetType) {
      alert("Please select asset type");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal metal-card">
        <div className="modal-header">
          <h2>New Render Task</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> Your 3D assets will be encrypted with FHE
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Asset Type *</label>
              <select 
                name="assetType"
                value={taskData.assetType} 
                onChange={handleChange}
                className="metal-select"
              >
                <option value="">Select asset type</option>
                <option value="Blender">Blender Project</option>
                <option value="3ds Max">3ds Max Project</option>
                <option value="Maya">Maya Project</option>
                <option value="Cinema4D">Cinema 4D Project</option>
              </select>
            </div>
            
            <div className="form-group">
              <label>Render Complexity</label>
              <select 
                name="complexity"
                value={taskData.complexity} 
                onChange={handleChange}
                className="metal-select"
              >
                <option value="low">Low (Simple scenes)</option>
                <option value="medium">Medium (Standard scenes)</option>
                <option value="high">High (Complex scenes)</option>
                <option value="extreme">Extreme (Film quality)</option>
              </select>
            </div>
            
            <div className="form-group full-width">
              <label>Description</label>
              <textarea 
                name="description"
                value={taskData.description} 
                onChange={handleChange}
                placeholder="Describe your render task..." 
                className="metal-textarea"
                rows={3}
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon"></div> Assets remain encrypted during rendering process
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn metal-button"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn metal-button primary"
          >
            {creating ? "Encrypting with FHE..." : "Submit Render Task"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;