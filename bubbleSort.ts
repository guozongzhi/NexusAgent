/**
 * 冒泡排序算法实现 (Bubble Sort)
 * 这是一个经典的排序算法，时间复杂度平均和最坏情况下为 O(n^2)。
 * 适用于教学和理解排序原理，但在实际生产环境中通常不推荐使用，
 * 应优先考虑如快速排序 (Quick Sort) 或归并排序 (Merge Sort) 等效率更高的算法。
 *
 * @param arr 要排序的数字数组
 * @returns 排序后的数组
 */
function bubbleSort(arr: number[]): number[] {
    const n = arr.length;
    // 创建一个副本进行操作，避免修改原始数组（遵循函数式编程的最佳实践）
    const arrayCopy = [...arr];
    let swapped: boolean;

    for (let i = 0; i < n - 1; i++) {
        swapped = false;
        // 每一趟比较的次数会比前一趟少一位，因为最后 i 个元素已经到位
        for (let j = 0; j < n - 1 - i; j++) {
            // 如果当前元素大于下一个元素，则交换它们的位置
            if (arrayCopy[j] > arrayCopy[j + 1]) {
                // 交换操作
                [arrayCopy[j], arrayCopy[j + 1]] = [arrayCopy[j + 1], arrayCopy[j]];
                swapped = true;
            }
        }
        
        // 如果在一趟遍历中没有发生任何交换，说明数组已经有序，提前退出
        if (!swapped) {
            break;
        }
    }
    return arrayCopy;
}

// --- 使用示例 ---
const unsortedArray: number[] = [64, 34, 25, 12, 22, 11, 90];
console.log("原始数组:", unsortedArray);

const sortedArray = bubbleSort(unsortedArray);

console.log("排序后数组:", sortedArray);

// 另一个测试用例
const testArray2: number[] = [5, 1, 4, 2, 8];
console.log("\n原始数组 2:", testArray2);
console.log("排序后数组 2:", bubbleSort(testArray2));