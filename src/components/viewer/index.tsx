"use client";
import dynamic from "next/dynamic";
import { RisoLoader } from "../ui";

export const Viewer = dynamic(() => import("./Viewer3D"), { ssr: false, loading: () => <RisoLoader label="Setting up the workbench…" /> });
export type { ViewerProps } from "./Viewer3D";
