const gulp = require("gulp");
const fs = require("fs");
const wabt = require("wabt")();
/**
 * A bunch of magic happens below to merge functions from a wat file
 * into the assemblyscript output wasm.
 *
 * The `ImportStatementToDelete` is a config setting that you might
 * have to update if the `export declare function keccak(...)`
 * is moved between different files.
 * 
 * If you change something and AS uses a different imported name,
 * don't forget to edit the entry function in keccak-funcs.wat
 * so that it matches. see the line near the bottom:
 *   (func $keccak/keccak ;; this name needs to match what assemblyscript generates
 * 
 */


//const USE_BIGNUM_HOST_FUNCS = true;


function mergeAndWriteWasm(useBignumHostFuncs, finalFileName) {
    /*****
    * load AssemblyScript wat code
    */

    /***
    * for now we're using `out/main.wat`, which is wat output generated by binaryen (used by asc).
    * commented out is use of wabt (wasm2wat) to generate wat output
    * wabt wasm2wat has a bug where the start func uses a function index rather than a function name
    * this breaks when inserting import statements, because all the function indexes get shifted
    * when the bug is fixed, we could use wasm2wat instead of asc/binaryen.
    const mainWasm = fs.readFileSync("out/main.wasm", "binary");
    var mainModule = wabt.readWasm(mainWasm, {readDebugNames: true});
    mainModule.validate();
    mainModule.resolveNames();
    mainModule.generateNames()
    mainModule.applyNames();
    const mainWat = mainModule.toText({});
    */

    console.log("loading out/main.wat...");
    const mainWat = fs.readFileSync("out/main.wat", "utf8");

    // remove commas from function names generated by binaryen to please wabt
    let mainWatReplaced = mainWat.replace(/Uint\d+Array,/g, "Uint64Array");
    mainWatReplaced = mainWatReplaced.replace(/Map<usize,/g, "Map<usize");

    var mainLines = mainWatReplaced.split("\n");
    console.log("main wat line count:", mainLines.length);
    // mainLines.length is 915
    // mainLines[0] is `(module`
    // mainLines[913] is is the closing paren `)`
    // mainLines[914] is an empty line ``
    // closing paren is second to last line


    /****
    * load websnark secp256k1 wat code
    */

    const secpWat = fs.readFileSync("src/secp256k1.wat", "utf8");

    /****
    * prepare to merge websnark secp256k1 wasm and the assemblyscript wasm
    *
    * TODO: this merging is fragile, it assumes particular forms of the wat code
    * It may beak with different versions of wabt/wasm2wat, or asc
    */


    // remove all `(type $tn)`, because the type section indexes won't match after all the merging
    // after being merged with the AS wat
    // remove `(type $t0)` in e.g. `(func $int_copy (export "int_copy") (export "f1m_copy") (type $t0) (param $p0 i32) (param $p1 i32)`
    const secpWatNoFuncTypes = secpWat.replace(/\(type \$t\d+\)/g, "");

    // remove `(type $t8 (func (param i32 i32 i32 i32)))` in the type section
    // or `(type $t3 (func (param i32 i32) (result i32)))`
    // TODO: only supports one result val, support multiple result vals someday
    const secpWatNoTypes = secpWatNoFuncTypes.replace(/\s\s\(type \$t\d+ \(func \(param( \w\d\d)+\)\s*(\(result \w\d\d\))*\)\)\n/g, "");

    // write intermediate output for debugging
    //fs.writeFileSync("out/secp_no_types.wat", secpWatNoTypes);

    // remove first two lines
    // (module
    //   (import "env" "memory" (memory $env.memory 1000))

    let secpPreprocessLines = secpWatNoTypes.split("\n");
    // TODO: check that first two lines are as expected
    secpPreprocessLines.splice(0, 2);
    const secpFuncsClosed = secpPreprocessLines.join("\n");

    // remove closing parenthesis. example wat code with the closing parenthesis that needs to be removed:
    //   (data $d25 (i32.const 4456) "\97 ~HZ.6\d7\dbf\bc)S)\1e#\9c\12\fd3\c0H\9f\97H\9f\08\e9C\e6\81\99\e2\ab\db\d3\d2\a6^\b1M\c6\1d\1f]]\fc\8d6\c1\19\ac\9a\b5\b6p\d6\82\a5\d4\1f\85?\cf\d1\03\00\00\01\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00")
    //   (data $d26 (i32.const 4552) "\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\d1\03\00\00\01\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00"))

    const secpFuncsNoClosingParen = secpFuncsClosed.replace(/(\(data \$d\d\d \(i32.const \d+\) \".*\"\))\)/g, "$1");

    // awkward, but we can't control the func name that assemblyscript generates
    // so we have to change the websnark func names to match what AS expects
    let secpFuncsRenamed = secpFuncsNoClosingParen.replace("$g1m_toMontgomery", "$websnark_secp256k1/secp_g1m_toMontgomery");
    secpFuncsRenamed = secpFuncsRenamed.replace("$g1m_timesScalar", "$websnark_secp256k1/secp_g1m_timesScalar");
    secpFuncsRenamed = secpFuncsRenamed.replace(/\$g1m_add/g, "\$websnark_secp256k1/secp_g1m_add");
    secpFuncsRenamed = secpFuncsRenamed.replace(/\$fr_inverse/g, "\$websnark_secp256k1/secp_fr_inverse");
    secpFuncsRenamed = secpFuncsRenamed.replace(/\$g1m_affine/g, "\$websnark_secp256k1/secp_g1m_affine");
    secpFuncsRenamed = secpFuncsRenamed.replace(/\$g1m_fromMontgomery/g, "\$websnark_secp256k1/secp_g1m_fromMontgomery");
    secpFuncsRenamed = secpFuncsRenamed.replace(/\$f1m_neg/g, "\$websnark_secp256k1/secp_f1m_neg");
    secpFuncsRenamed = secpFuncsRenamed.replace(/\$frm_neg/g, "\$websnark_secp256k1/secp_frm_neg");

    let secpFuncsWat = secpFuncsRenamed;

    // for debugging
    fs.writeFileSync("out/secp_funcs.wat", secpFuncsWat);


    if (useBignumHostFuncs) {

        /****
        * insert bignum host function import statements
        */
        const bignumf1mToMontImport = '(import "env" "bignum_f1m_toMontgomery" (func $main/bignum_f1m_toMontgomery (param i32 i32)))';
        const bignumf1mFromMontImport = '(import "env" "bignum_f1m_fromMontgomery" (func $main/bignum_f1m_fromMontgomery (param i32 i32)))';
        const bignumf1mMulImport = '(import "env" "bignum_f1m_mul" (func $main/bignum_f1m_mul (param i32 i32 i32)))';
        const bignumf1mSqrImport = '(import "env" "bignum_f1m_square" (func $main/bignum_f1m_square (param i32 i32)))';
        const bignumf1mAddImport = '(import "env" "bignum_f1m_add" (func $main/bignum_f1m_add (param i32 i32 i32)))';
        const bignumf1mSubImport = '(import "env" "bignum_f1m_sub" (func $main/bignum_f1m_sub (param i32 i32 i32)))';
        const bignumIntMulImport = '(import "env" "bignum_int_mul" (func $main/bignum_int_mul (param i32 i32 i32)))';
        const bignumIntAddImport = '(import "env" "bignum_int_add" (func $main/bignum_int_add (param i32 i32 i32) (result i32)))';
        const bignumIntSubImport = '(import "env" "bignum_int_sub" (func $main/bignum_int_sub (param i32 i32 i32) (result i32)))';
        const bignumIntDivImport = '(import "env" "bignum_int_div" (func $main/bignum_int_div (param i32 i32 i32 i32)))';


        const bignumImportStatements = [bignumf1mToMontImport, bignumf1mFromMontImport,
                                        bignumf1mMulImport, bignumf1mAddImport, bignumf1mSubImport, bignumf1mSqrImport,
                                        bignumIntMulImport, bignumIntAddImport, bignumIntSubImport, bignumIntDivImport];



        /*
        const bignumImportStatements = [
                                        bignumf1mToMontImport, bignumf1mFromMontImport,
                                        //bignumf1mMulImport, bignumf1mAddImport, bignumf1mSubImport, bignumf1mSqrImport,
                                        bignumf1mAddImport, bignumf1mSubImport,
                                        bignumIntMulImport, bignumIntAddImport, bignumIntSubImport, bignumIntDivImport];
        */

        //const bignumImportStatements = [bignumf1mMulImport, bignumf1mAddImport, bignumf1mSubImport, bignumf1mSqrImport];
        //const bignumImportStatements = [bignumIntMulImport, bignumIntAddImport, bignumIntSubImport, bignumIntDivImport];

        //const bignumImportStatements = [bignumIntMulImport, bignumIntAddImport, bignumIntSubImport];


        // find line number to insert at (after last import)
        var foundLastImport = false;
        var foundFirstImport = false;
        let line_i = 0;
        while (!foundLastImport) {
          console.log("checking line_i="+line_i+" for an import:", mainLines[line_i]);
          if (mainLines[line_i].includes('(import') == true) {
            console.log("found import statement. checking next line..");
            foundFirstImport = true;
            // splice on mainLines will delete a line. use same `i` to search the next line
          } else if (foundFirstImport == true) {
            // no import statement is on this line.
            // if one was already found before, assume the previous line was the last import
            foundLastImport = true;
          }
          line_i++;
        }
        const lastImportLine = line_i - 1;

        console.log('last import:', mainLines[lastImportLine]);
        mainLines.splice(lastImportLine, 0, ...bignumImportStatements);


        /****
        * replace websnark calls to bignum funcs with calls to host funcs
        */

        // example function declaration: (func $f1m_mul (export "f1m_mul")  (param $p0 i32) (param $p1 i32) (param $p2 i32)

        // TODO: automate check that replacing `(call $f1m_mul` works.
        //  e.g. check that `(call $f1m_mul` is found 39 times, and that `$f1m_mul` is found 40 times (one more for the function declaration)

        let secpUsingBignumFuncs = secpFuncsWat;

        secpUsingBignumFuncs = secpUsingBignumFuncs.replace(/\(call \$f1m_mul/g, "\(call \$main/bignum_f1m_mul");
        secpUsingBignumFuncs = secpUsingBignumFuncs.replace(/\(call \$f1m_square/g, "\(call \$main/bignum_f1m_square");
        secpUsingBignumFuncs = secpUsingBignumFuncs.replace(/\(call \$f1m_add/g, "\(call \$main/bignum_f1m_add");
        secpUsingBignumFuncs = secpUsingBignumFuncs.replace(/\(call \$f1m_sub/g, "\(call \$main/bignum_f1m_sub");

        secpUsingBignumFuncs = secpUsingBignumFuncs.replace(/\(call \$f1m_toMontgomery/g, "\(call \$main/bignum_f1m_toMontgomery");
        secpUsingBignumFuncs = secpUsingBignumFuncs.replace(/\(call \$f1m_fromMontgomery/g, "\(call \$main/bignum_f1m_fromMontgomery");

        secpUsingBignumFuncs = secpUsingBignumFuncs.replace(/\(call \$int_mul/g, "\(call \$main/bignum_int_mul");
        secpUsingBignumFuncs = secpUsingBignumFuncs.replace(/\(call \$int_add/g, "\(call \$main/bignum_int_add");
        secpUsingBignumFuncs = secpUsingBignumFuncs.replace(/\(call \$int_sub/g, "\(call \$main/bignum_int_sub");
        secpUsingBignumFuncs = secpUsingBignumFuncs.replace(/\(call \$int_div/g, "\(call \$main/bignum_int_div");


        secpFuncsWat = secpUsingBignumFuncs;

        // for debugging
        fs.writeFileSync("out/secp_funcs_bignum_host.wat", secpFuncsWat);
    }


    /****
    * insert websnark code
    */

    // closing paren is second to last line
    let closing_paren_ix_before_websnark_merge = mainLines.length - 2;

    const secpLines = secpFuncsWat.split("\n");
    mainLines.splice(closing_paren_ix_before_websnark_merge, 0, ...secpLines );
    console.log('mainLines with websnark_secp256k1 inserted:', mainLines.length);


    /****
    * load keccak code and insert
    */

    const keccakWat = fs.readFileSync("src/tinykeccak_funcs.wat", "utf8");
    const keccakLines = keccakWat.split("\n")

    let closing_paren_ix_before_keccak_merge = mainLines.length - 2;

    mainLines.splice(closing_paren_ix_before_keccak_merge, 0, ...keccakLines );
    console.log('mainLines with keccak inserted:', mainLines.length);


    /****
    * delete import statements generated by assemblyscript
    */

    console.log("searching for import statements to delete...");

    var foundImport = false;
    let i = 0;
    let i_max = 40;
    while (i < i_max) {
      console.log(mainLines[i]);
      if (mainLines[i].includes('import "watimports"') == true) {
        console.log("found import statement!! deleting it...");
        mainLines.splice(i, 1);
        foundImport = true;
        // splice on mainLines will delete a line. use same `i` to search the next line
      } else {
        // go to next line
        i = i + 1;
      }
    }

    if (!foundImport) {
      console.log("ERROR!! Couldn't find assemblyscript import statement(s)! wat parsing will probably fail.");
    }

    console.log('mainLines length after deleting import statements:', mainLines.length);

    var merged_wat = mainLines.join("\n");

    // write merged wat for debugging purposes
    fs.writeFileSync("out/main_with_websnark_and_keccak_merged.wat", merged_wat);


    // convert wat to binary using wabt
    var features = {'mutable_globals':false};
    var myModule = wabt.parseWat("main_with_websnark_and_keccak.wat", merged_wat, features);
    console.log('parsed merged wat..');
    myModule.resolveNames();
    console.log('names resolved...');
    myModule.validate();
    console.log('myModule validated!!');
    let binary_result = myModule.toBinary({ write_debug_names: true });

    // write binary wasm file
    fs.writeFileSync("out/"+finalFileName, binary_result.buffer);
}



/*
  Runtime variants:
  "--runtime", "full" (default)
    A proper memory manager and reference-counting based garbage collector, with runtime interfaces
    being exported to the host for being able to create managed objects externally.
  "--runtime", "half"
    The same as full but without any exports, i.e. where creating objects externally is not required.
    This allows the optimizer to eliminate parts of the runtime that are not needed.
  "--runtime", "stub"
    A minimalist arena memory manager without any means of freeing up memory again, but the same external
    interface as full. Useful for very short-lived programs or programs with hardly any memory footprint,
    while keeping the option to switch to full without any further changes. No garbage collection.
  "--runtime", "none"
    The same as stub but without any exports, for the same reasons as explained in half. Essentially
    evaporates entirely after optimizations.
    For more information see: https://docs.assemblyscript.org/details/runtime
*/
//gulp.task("build", callback => {
function build(callback) {
  console.log('gulp.js build task..');
  const asc = require("assemblyscript/bin/asc");


  asc.main([
    "main.ts",
    //"--baseDir", "assembly",
    "--binaryFile", "out/main.wasm",
    "--textFile", "out/main.wat",
    "--sourceMap",
    "--measure",
    "--runtime", "none",
    "--use", "abort=",
    "--memoryBase", "32768",
    "--optimize"
  ], ascDone);


  function ascDone(res) {
    console.log("ascDone res:", res)
    if (res) {
      throw new Error("AssemblyScript error!!");
    }
    
    mergeWats();
  }

  function mergeWats() {
    console.log('wabt:', wabt);

    mergeAndWriteWasm(true, 'main_with_websnark_and_keccak.wasm')
    mergeAndWriteWasm(false, 'main_with_websnark_and_keccak_no_bignums.wasm')

    console.log('done merging wat codes.');

    callback();
  }


}


exports.build = build;
exports.default = build;