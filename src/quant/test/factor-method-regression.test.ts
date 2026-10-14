import {expect,test} from "bun:test";
import {rsi,smaDeviation,computeFactor} from "../factor.ts";

test("Wilder consumes the newly observed loss once after the seed",()=>{
 expect(rsi([10,11,12,11,10],2)).toEqual([null,null,100,50,25]);
});
test("mixed seed and changing gains remain aligned with their own close",()=>{
 const result=rsi([10,9,10,12,11,13],2);
 expect(result.slice(0,3)).toEqual([null,null,50]);
 expect(result[3]).toBeCloseTo(250/3,12);expect(result[4]).toBeCloseTo(50,12);expect(result[5]).toBeCloseTo(1050/13,12);
});
test("period fourteen reacts to the final close without a one-observation delay",()=>{
 const close=Array.from({length:15},(_,index)=>100+index);close.push(100);
 const result=rsi(close,14);expect(result.slice(0,14)).toEqual(Array(14).fill(null));expect(result[14]).toBe(100);expect(result[15]).toBeCloseTo(1300/27,12);
});
test("a one-interval RSI uses each new delta",()=>{
 expect(rsi([10,11,10,12],1)).toEqual([null,100,0,100]);
});
test("SMA difference requires both windows even when the requested long window is shorter",()=>{
 const result=smaDeviation([100,101,102,103,104,105],5,2);
 expect(result.slice(0,4)).toEqual([null,null,null,null]);expect(result[4]).toBeCloseTo(-1.5/103.5,12);expect(result[5]).toBeCloseTo(-1.5/104.5,12);
});
test("the six-factor matrix has independent expected values at its final falling close",()=>{
 const close=Array.from({length:40},(_,index)=>index===39?124:100+index),volume=Array(40).fill(10);
 expect(computeFactor("momentum",close,volume,2).at(-1)).toBeCloseTo(-13/137,12);
 expect(computeFactor("reversal",close,volume,2).at(-1)).toBeCloseTo(13/137,12);
 expect(computeFactor("volatility",close,volume,2).at(-1)).toBeCloseTo((1/137+7/69)/Math.sqrt(2),12);
 expect(computeFactor("volume_ratio",close,volume,20).at(-1)).toBe(1);
 expect(computeFactor("rsi",close,volume,14).at(-1)).toBeCloseTo(1300/27,12);
 expect(computeFactor("sma_deviation",close,volume,20).at(-1)).toBeCloseTo(21/515,12);
});
