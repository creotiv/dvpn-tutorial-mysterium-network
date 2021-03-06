/**
 * Copyright (c) 2021 BlockDev AG
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
 import { platform } from "os"
 import { ChildProcess } from "child_process"
 
 import { NodeHealthcheck, TequilapiClientFactory } from "mysterium-vpn-js"
 import { BrowserWindow, ipcMain } from "electron"
 
 import { log } from "../../shared/log"
 import { staticAssetPath, spawnProcess } from "../../shared/utils"
 import {  MainIpcListenChannels } from "../../shared/ipc/ipcChannels"
 import * as isDev from "electron-is-dev"

 const TEQUILAPI_PORT = 44050;
 
 const mystBin = (): string => {
     let mystBinaryName = "bin/myst"
     if (platform() === "win32") {
         mystBinaryName += ".exe"
     }
     return staticAssetPath(mystBinaryName)
 } 
 export class MysteriumNode {
     port?: number
     proc?: ChildProcess
 
     registerIPC(getMainWindow: () => BrowserWindow | null): void {
         ipcMain.handle(MainIpcListenChannels.StartNode, () => {
             return this.start()
         })
         ipcMain.handle(MainIpcListenChannels.StopNode, () => {
             return this.stop()
         })
         ipcMain.handle(MainIpcListenChannels.KillGhosts, async () => {
             if (!isDev) {
                 await Promise.all([this.killGhost(4050), this.killGhost(44050)])
             }
         })
     }
 
     // Myst process is not started from supervisor as supervisor runs as root user
     // which complicates starting myst process as non root user.
     start(port = TEQUILAPI_PORT): Promise<void> {
         this.port = port
         const mystProcess = spawnProcess(
             mystBin(),
             [
                 "--ui.enable=false",
                 "--usermode",
                 "--consumer",
                 `--tequilapi.port=${port}`,
                 "--discovery.type=api",
                 "daemon",
             ],
             {
                 stdio: "ignore", // Needed for unref to work correctly.
             },
         )
 
         mystProcess.stdout?.on("data", (d) => {
             log.info(d)
         })
 
         this.proc = mystProcess
 
         mystProcess.on("close", (code) => {
             log.info(`myst process exited with code ${code}`)
         })
 
         return Promise.resolve()
     }
 
     async killGhost(port: number): Promise<void> {
         const api = new TequilapiClientFactory(`http://127.0.0.1:${port}`, 3_000).build()
         let hc: NodeHealthcheck | undefined
         try {
             hc = await api.healthCheck(100)
         } catch (err) {
             log.info("No ghosts found on port", port)
         }
         if (!hc?.process) {
             return
         }
         log.info("Found a ghost node on port", port, "PID", hc.process)
         log.info("Attempting to shutdown gracefully")
         try {
             await api.stop()
             return
         } catch (err) {
             log.error("Could not stop node on port " + port +": "+err)
         }
         log.info("Attempting to kill process", hc.process)
         try {
             process.kill(hc.process)
         } catch (err) {
             log.error("Could not kill process PID " + hc.process +": "+err)
         }
     }
 
     async stop(): Promise<void> {
         log.info("Stopping myst")
         if (this.port) {
             log.info("Shutting down node gracefully on port", this.port)
             const api = new TequilapiClientFactory(`http://127.0.0.1:${this.port}`, 3_000).build()
             try {
                 await api.stop()
                 return
             } catch (err) {
                 log.error("Could not shutdown Mysterium node gracefully: "+err)
             }
         }
         if (this.proc) {
             log.info("Killing node process", this.proc.pid)
             try {
                 this.proc.kill()
             } catch (err) {
                 log.error("Could not kill node process: "+err)
             }
         }
     }
 }
 
 export const mysteriumNode = new MysteriumNode()